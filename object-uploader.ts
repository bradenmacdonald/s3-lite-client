import type { Client, UploadedObjectInfo } from "./client.ts";
import { getVersionId, sanitizeETag } from "./helpers.ts";

/**
 * Stream a file to S3
 */
export class ObjectUploader extends WritableStream<Uint8Array> {
  uploadDone: Promise<UploadedObjectInfo>;

  constructor({ client, bucketName, objectName, partSize, metaData }: {
    client: Client;
    bucketName: string;
    objectName: string;
    partSize: number;
    metaData: Record<string, string>;
  }) {
    let markUploadDone: (result: UploadedObjectInfo) => void,
      markUploadError: (err: Error) => void;
    let uploadFailed = false;
    const uploadDone = new Promise<UploadedObjectInfo>((resolve, reject) => {
      markUploadDone = resolve;
      markUploadError = (err: Error) => {
        reject(err);
        uploadFailed = true;
      };
    });
    let nextPartNumber = 1;
    let uploadId: string;
    const etags: { part: number; etag: string }[] = [];

    super({
      start() {}, // required
      async write(chunk, _controller) {
        if (uploadFailed) {
          return; // Ignore further data.
        }
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
            markUploadDone({
              etag: sanitizeETag(response.headers.get("etag") ?? undefined),
              versionId: getVersionId(response.headers),
            });
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
          markUploadError(err);
          // Throwing an error will make future writes to this fail with the given error,
          // but it also causes an uncaught promise somewhere. TODO: hunt down that uncaught promise.
          //throw err;
        }
      },
      close() {
      },
    });

    this.uploadDone = uploadDone;
  }
}
