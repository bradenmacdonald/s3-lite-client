import type { Client, UploadedObjectInfo } from "./client.ts";
// import { crypto, encodeBase64 } from "./deps.ts";
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
      markUploadError: () => void;
    const uploadDone = new Promise<UploadedObjectInfo>((resolve, reject) => {
      markUploadDone = resolve;
      markUploadError = reject;
    });
    let nextPartNumber = 1;
    let uploadId: string;
    const etags: { part: number; etag: string }[] = [];

    super({
      start() {}, // required
      async write(chunk, controller) {
        const method = "PUT";
        const headers = {
          "Content-Length": String(chunk.length),
        };
        const partNumber = nextPartNumber++;

        try {
          // We are going to upload this file in a single part, because it's small enough
          if (partNumber == 1 && chunk.length < partSize) {
            // PUT the chunk in a single request — use an empty query.
            const options = {
              method,
              // Set user metadata as this is not a multipart upload
              headers: { ...metaData, ...headers },
              query: "",
              bucketName,
              objectName,
            };

            const response = await client.makeRequest(options, chunk);
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
          const query = new URLSearchParams({
            partNumber: partNumber.toString(),
            uploadId,
          }).toString();
          const options = {
            method,
            query,
            headers,
            bucketName: bucketName,
            objectName: objectName,
          };

          const response = await client.makeRequest(options, chunk);
          // In order to aggregate the parts together, we need to collect the etags.
          let etag = response.headers.get("etag") ?? "";
          if (etag) {
            etag = etag.replace(/^"/, "").replace(/"$/, "");
          }
          etags.push({ part: partNumber, etag });
        } catch (err) {
          markUploadError();
          controller.error(err);
        }
      },
      close() {
      },
    });

    this.uploadDone = uploadDone;
  }
}
