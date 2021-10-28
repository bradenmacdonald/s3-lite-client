import type { Client, UploadedObjectInfo } from "./client.ts";
import { getVersionId, sanitizeETag } from "./helpers.ts";

/**
 * Stream a file to S3
 *
 * We assume that TransformChunkSizes has been used first, so that this stream
 * will always receive chunks of exactly size "partSize", except for the final
 * chunk.
 *
 * Note that the total size of the upload doesn't have to be known in advance,
 * as long as TransformChunkSizes was used first. Then this ObjectUploader
 * will decide based on the size of the first chunk whether it is doing a
 * single-request upload or a multi-part upload.
 */
export class ObjectUploader extends WritableStream<Uint8Array> {
  public readonly getResult: () => UploadedObjectInfo;

  constructor({ client, bucketName, objectName, partSize, metaData }: {
    client: Client;
    bucketName: string;
    objectName: string;
    partSize: number;
    metaData: Record<string, string>;
  }) {
    let result: UploadedObjectInfo;
    let nextPartNumber = 1;
    let uploadId: string;
    const etags: { part: number; etag: string }[] = [];

    super({
      start() {}, // required
      async write(chunk, _controller) {
        const method = "PUT";
        const partNumber = nextPartNumber++;

        try {
          // We are going to upload this file in a single part, because it's small enough
          if (partNumber == 1 && chunk.length < partSize) {
            // PUT the chunk in a single request — use an empty query.
            const response = await client.makeRequest({
              method,
              headers: new Headers({
                // Set user metadata as this is not a multipart upload
                ...metaData,
                "Content-Length": String(chunk.length),
              }),
              bucketName,
              objectName,
              payload: chunk,
            });
            result = {
              etag: sanitizeETag(response.headers.get("etag") ?? undefined),
              versionId: getVersionId(response.headers),
            };
            return;
          }

          /// If we get here, this is a streaming upload in multiple parts.
          if (partNumber === 1) {
            uploadId = (await client.initiateNewMultipartUpload({
              bucketName,
              objectName,
              metaData,
            })).uploadId;
          }
          // Upload the next part
          const response = await client.makeRequest({
            method,
            query: { partNumber: partNumber.toString(), uploadId },
            headers: new Headers({ "Content-Length": String(chunk.length) }),
            bucketName: bucketName,
            objectName: objectName,
            payload: chunk,
          });
          // In order to aggregate the parts together, we need to collect the etags.
          let etag = response.headers.get("etag") ?? "";
          if (etag) {
            etag = etag.replace(/^"/, "").replace(/"$/, "");
          }
          etags.push({ part: partNumber, etag });
        } catch (err) {
          // Throwing an error will make future writes to this sink fail.
          throw err;
        }
      },
      async close() {
        if (result) {
          // This was already completed, in a single upload. Nothing more to do.
        } else if (uploadId) {
          // Complete the multi-part upload
          result = await client.completeMultipartUpload({ bucketName, objectName, uploadId, etags });
        } else {
          throw new Error("Stream was closed without uploading any data.");
        }
      },
    });
    this.getResult = () => {
      if (result === undefined) {
        throw new Error("Result is not ready. await the stream first.");
      }
      return result;
    };
  }
}
