import type { Client, ObjectMetadata, UploadedObjectInfo } from "./client.ts";
import { encoder, getVersionId, sanitizeETag, type Uint8Array_ } from "./helpers.ts";
import { childText, parse as parseXML } from "./xml-parser.ts";

// Metadata headers that must be included in each part of a multi-part upload
const multipartTagAlongMetadataKeys = [
  "x-amz-server-side-encryption-customer-algorithm",
  "x-amz-server-side-encryption-customer-key",
  "x-amz-server-side-encryption-customer-key-MD5",
];

/**
 * How many parts of a multi-part upload we will upload in parallel. Each part in flight is held in
 * memory until the server has accepted it, so this puts an upper bound on how much memory an upload
 * can use (roughly this many times the part size).
 */
const maxConcurrentParts = 4;

/** The maximum number of parts in a multi-part upload. https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html */
const maxParts = 10_000;

/**
 * Upload an object using a single PUT request, and return the resulting object info.
 *
 * This can only be used for objects up to 5GB, and is what we use whenever the data is small enough
 * that we don't need a multi-part upload.
 */
export async function uploadSingleRequest(
  { client, metadata, ...requestArgs }: {
    client: Client;
    bucketName: string;
    objectName: string;
    metadata: Record<string, string>;
    payload: Uint8Array_ | string;
  },
): Promise<UploadedObjectInfo> {
  const response = await client.makeRequest({
    method: "PUT",
    // Set user metadata as this is not a multipart upload. (makeRequest sets Content-Length for us.)
    headers: new Headers(metadata),
    ...requestArgs,
  });
  return {
    etag: sanitizeETag(response.headers.get("etag") ?? undefined),
    versionId: getVersionId(response.headers),
  };
}

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
export class ObjectUploader extends WritableStream<Uint8Array_> {
  public readonly getResult: () => UploadedObjectInfo;

  constructor({ client, bucketName, objectName, partSize, metadata }: {
    client: Client;
    bucketName: string;
    objectName: string;
    partSize: number;
    metadata: Record<string, string>;
  }) {
    let result: UploadedObjectInfo;
    let nextPartNumber = 1;
    let uploadId: string;
    const etags: { part: number; etag: string }[] = [];
    /** If an error occurs during multi-part uploads, we temporarily store it here. */
    let multiUploadError: Error | undefined;
    /**
     * If doing a multi-part upload, this holds a promise for each part that is currently being
     * uploaded, so that we can upload several parts in parallel but never more than
     * `maxConcurrentParts` at once. Each promise removes itself from the set once it has settled.
     */
    const partsInFlight = new Set<Promise<void>>();

    super({
      start() {}, // required
      async write(chunk, _controller) {
        const method = "PUT";
        const partNumber = nextPartNumber++;

        try {
          // We are going to upload this file in a single part, because it's small enough
          if (partNumber == 1 && chunk.length < partSize) {
            result = await uploadSingleRequest({ client, bucketName, objectName, metadata, payload: chunk });
            return;
          }
          if (partNumber > maxParts) {
            throw new Error(
              `Cannot upload more than ${maxParts} parts. If you are uploading a stream of unknown size, ` +
                `specify its "size" or use a larger "partSize" (currently ${partSize} bytes).`,
            );
          }

          /// If we get here, this is a streaming upload in multiple parts.
          if (partNumber === 1) {
            uploadId = (await initiateNewMultipartUpload({
              client,
              bucketName,
              objectName,
              metadata,
            })).uploadId;
          }
          // Upload the next part
          const partHeaders: Record<string, string> = {
            "Content-Length": String(chunk.length),
          };
          for (const key of multipartTagAlongMetadataKeys) {
            const value = metadata[key];
            if (value) {
              partHeaders[key] = value;
            }
          }
          // We can't `await` the upload of this part now, because that will cause the uploads to
          // happen in series instead of parallel. But we don't want to let the promise
          // throw an exception when we haven't awaited it, because that can cause the
          // process to crash. So use .catch() to watch for errors and store them in
          // `multiUploadError` if they occur.
          const partPromise: Promise<void> = client.makeRequest({
            method,
            query: { partNumber: partNumber.toString(), uploadId },
            headers: new Headers(partHeaders),
            bucketName: bucketName,
            objectName: objectName,
            payload: chunk,
          }).then((response) => {
            // In order to aggregate the parts together, we need to collect the etags.
            etags.push({ part: partNumber, etag: sanitizeETag(response.headers.get("etag") ?? undefined) });
          }).catch((err) => {
            // An error occurred when uploading this one part:
            if (!multiUploadError) {
              multiUploadError = err;
            }
          }).finally(() => {
            partsInFlight.delete(partPromise);
          });
          partsInFlight.add(partPromise);
          // Don't start uploading the next part until one of the parts in flight has finished.
          // Without this, a large upload would read the whole stream into memory at once.
          if (partsInFlight.size >= maxConcurrentParts) {
            await Promise.race(partsInFlight);
          }
        } catch (err) {
          // Throwing an error will make future writes to this sink fail.
          throw err;
        }
      },
      async close() {
        if (result) {
          // This was already completed, in a single upload. Nothing more to do.
        } else if (uploadId) {
          // Wait for all parts to finish uploading (or fail)
          await Promise.all(partsInFlight);
          if (multiUploadError) {
            // One or more parts failed to upload:
            throw multiUploadError;
          }
          // Sort the etags (required)
          etags.sort((a, b) => a.part > b.part ? 1 : -1);
          // Complete the multi-part upload
          result = await completeMultipartUpload({ client, bucketName, objectName, uploadId, etags });
        } else {
          // The stream closed without ever producing a chunk, so this is an empty object. S3
          // supports those, and this is what you get if you upload an empty string/Uint8Array.
          result = await uploadSingleRequest({
            client,
            bucketName,
            objectName,
            metadata,
            payload: new Uint8Array(),
          });
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

/** Initiate a new multipart upload request. */
async function initiateNewMultipartUpload(
  options: {
    client: Client;
    bucketName: string;
    objectName: string;
    metadata?: ObjectMetadata;
  },
): Promise<{ uploadId: string }> {
  const method = "POST";
  const headers = new Headers(options.metadata);
  const query = "uploads";
  const response = await options.client.makeRequest({
    method,
    bucketName: options.bucketName,
    objectName: options.objectName,
    query,
    headers,
    returnBody: true,
  });
  // Response is like:
  // <InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  //   <Bucket>dev-bucket</Bucket>
  //   <Key>test-32m.dat</Key>
  //   <UploadId>422f976b-35e0-4a55-aca7-bf2d46277f93</UploadId>
  // </InitiateMultipartUploadResult>
  const responseText = await response.text();
  const root = parseXML(responseText);
  if (root?.name !== "InitiateMultipartUploadResult") {
    throw new Error(`Unexpected response: ${responseText}`);
  }
  const uploadId = childText(root, "UploadId");
  if (!uploadId) {
    throw new Error(`Unable to get UploadId from response: ${responseText}`);
  }
  return { uploadId };
}

async function completeMultipartUpload(
  { client, bucketName, objectName, uploadId, etags }: {
    client: Client;
    bucketName: string;
    objectName: string;
    uploadId: string;
    etags: { part: number; etag: string }[];
  },
): Promise<UploadedObjectInfo> {
  const payload = `
    <CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        ${etags.map((et) => `  <Part><PartNumber>${et.part}</PartNumber><ETag>${et.etag}</ETag></Part>`).join("\n")}
    </CompleteMultipartUpload>
  `;
  const response = await client.makeRequest({
    method: "POST",
    bucketName,
    objectName,
    query: `uploadId=${encodeURIComponent(uploadId)}`,
    payload: encoder.encode(payload),
    returnBody: true,
  });
  const responseText = await response.text();
  // Example response:
  // <?xml version="1.0" encoding="UTF-8"?>
  // <CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  //   <Location>http://localhost:9000/dev-bucket/test-32m.dat</Location>
  //   <Bucket>dev-bucket</Bucket>
  //   <Key>test-32m.dat</Key>
  //   <ETag>&#34;4581589392ae60eafdb031f441858c7a-7&#34;</ETag>
  // </CompleteMultipartUploadResult>
  const root = parseXML(responseText);
  if (root?.name !== "CompleteMultipartUploadResult") {
    throw new Error(`Unexpected response: ${responseText}`);
  }
  const etagRaw = childText(root, "ETag");
  if (!etagRaw) throw new Error(`Unable to get ETag from response: ${responseText}`);
  const versionId = getVersionId(response.headers);
  return {
    etag: sanitizeETag(etagRaw),
    versionId,
  };
}
