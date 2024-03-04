# s3-lite-client

This is a lightweight S3 client for Deno and other modern JavaScript runtimes. It is designed to offer all the key
features you may need, with no dependencies outside of the Deno standard library. It does not use any Deno-specific
features, so it should work with any runtime that supports the `fetch` API, web streams API, and ES modules (ESM).

This client is 100% MIT licensed, and is derived from the excellent
[MinIO JavaScript Client](https://github.com/minio/minio-js).

Supported functionality:

- Authenticated or unauthenticated requests
- List objects: `for await (const object of client.listObjects(options)) { ... }`
  - Handles pagination transparently
  - Supports filtering using a prefix
  - Supports [grouping using a delimiter](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html)
    (use `client.listObjectsGrouped(...)`)
- Check if an object exists: `client.exists("key")`
- Get metadata about an object: `client.statObject("key")`
- Download an object: `client.getObject("key", options)`
  - This just returns a standard HTTP `Response` object, so for large files, you can opt to consume the data as a stream
    (use the `.body` property).
- Download a partial object: `client.getPartialObject("key", options)`
  - Like `getObject`, this also supports streaming the response if you want to.
- Upload an object: `client.putObject("key", streamOrData, options)`
  - Can upload from a `string`, `Uint8Array`, or `ReadableStream`
  - Can split large uploads into multiple parts and uploads parts in parallel.
- Copy an object: `client.copyObject({ sourceKey: "source", options }, "dest", options)`
  - Can copy between different buckets.
- Delete an object: `client.deleteObject("key")`
- Create pre-signed URLs: `client.presignedGetObject("key", options)` or
  `client.getPresignedUrl(method, "key", options)`
- Check if a bucket exists: `client.bucketExists("bucketName")`
- Create a new bucket: `client.makeBucket("bucketName")`
- Remove a bucket: `client.removeBucket("bucketName")`

## Installation

[![JSR Version](https://jsr.io/badges/@bradenmacdonald/s3-lite-client)](https://jsr.io/@bradenmacdonald/s3-lite-client)
[![JSR Score](https://jsr.io/badges/@bradenmacdonald/s3-lite-client/score)](https://jsr.io/@bradenmacdonald/s3-lite-client/score)

- Deno: `deno add @bradenmacdonald/s3-lite-client`
- Deno (no install): `import { S3Client } from "jsr:@bradenmacdonald/s3-lite-client@0.7.3";`
- NPM: `npx jsr add @bradenmacdonald/s3-lite-client`
- Yarn: `yarn dlx jsr add @bradenmacdonald/s3-lite-client`
- pnpm: `pnpm dlx jsr add @bradenmacdonald/s3-lite-client`
- Bun: `bunx jsr add @bradenmacdonald/s3-lite-client`
- Browser:
  ```html
  <script type="module">
    import { S3Client } from "https://esm.sh/jsr/@bradenmacdonald/s3-lite-client@0.7.3";
    // Or:
    const { S3Client } = await import('https://esm.sh/jsr/@bradenmacdonald/s3-lite-client@0.7.3');
  </script>
  ```

Note: if you're using Node.js, this only works on Node 19+.

## Usage Examples (Quickstart)

List data files from a public data set on Amazon S3:

```typescript
import { S3Client } from "@bradenmacdonald/s3-lite-client";

const s3client = new S3Client({
  endPoint: "s3.us-east-1.amazonaws.com",
  port: 443,
  useSSL: true,
  region: "us-east-1",
  bucket: "openalex",
  pathStyle: false,
});

// Log data about each object found under the 'data/concepts/' prefix:
for await (const obj of s3client.listObjects({ prefix: "data/concepts/" })) {
  console.log(obj);
}
// {
//   type: "Object",
//   key: "data/concepts/updated_date=2024-01-25/part_000.gz",
//   etag: "2c9b2843c8d2e9057656e1af1c2a92ad",
//   size: 44105,
//   lastModified: 2024-01-25T22:57:43.000Z
// },
// ...

// Or, to get all the keys (paths) as an array:
const keys = await Array.fromAsync(s3client.listObjects(), (entry) => entry.key);
// keys = [
//  "data/authors/manifest",
//  "data/authors/updated_date=2023-06-08/part_000.gz",
//  ...
// ]
```

Uploading and downloading a file using a local MinIO server:

```typescript
import { S3Client } from "@bradenmacdonald/s3-lite-client";

// Connecting to a local MinIO server:
const s3client = new S3Client({
  endPoint: "localhost",
  port: 9000,
  useSSL: false,
  region: "dev-region",
  accessKey: "AKIA_DEV",
  secretKey: "secretkey",
  bucket: "dev-bucket",
  pathStyle: true,
});

// Upload a file:
await s3client.putObject("test.txt", "This is the contents of the file.");

// Now download it
const result = await s3client.getObject("test.txt");
// and stream the results to a local file:
const localOutFile = await Deno.open("test-out.txt", { write: true, createNew: true });
await result.body!.pipeTo(localOutFile.writable);
// or instead of streaming, you can consume the whole file into memory by awaiting
// result.text(), result.blob(), result.arrayBuffer(), or result.json()
```

For more examples, check out the tests in [`integration.ts`](./integration.ts)

## Developer notes

To run the tests, please use:

```sh
deno lint && deno test
```

To format the code, use:

```sh
deno fmt
```

To run the integration tests, first start MinIO with this command:

```sh
docker run --rm -e MINIO_ROOT_USER=AKIA_DEV -e MINIO_ROOT_PASSWORD=secretkey -e MINIO_REGION_NAME=dev-region -p 9000:9000 -p 9001:9001 --entrypoint /bin/sh minio/minio:RELEASE.2021-10-23T03-28-24Z -c 'mkdir -p /data/dev-bucket && minio server --console-address ":9001" /data'
```

Then while MinIO is running, run

```sh
deno test --allow-net integration.ts
```

(If you encounter issues and need to debug what MinIO is seeing, run these two commands:)

```sh
mc alias set localdebug http://localhost:9000 AKIA_DEV secretkey
mc admin trace --verbose --all localdebug
```
