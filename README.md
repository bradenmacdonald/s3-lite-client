# s3-lite-client

![MIT License](https://img.shields.io/npm/l/%40bradenmacdonald%2Fs3-lite-client)
[![no dependencies](https://depx.co/api/badge/@bradenmacdonald/s3-lite-client)](https://depx.co/pkg/@bradenmacdonald/s3-lite-client)
[![minimized gzipped size](https://img.shields.io/bundlejs/size/%40bradenmacdonald%2Fs3-lite-client)](https://bundlejs.com/?q=%40bradenmacdonald%2Fs3-lite-client&treeshake=%5B*%5D&text=%22const+s3client+%3D+new+S3Client%28%7B%5Cn++endPoint%3A+%5C%22https%3A%2F%2Fs3.us-east-1.amazonaws.com%5C%22%2C%5Cn++region%3A+%5C%22us-east-1%5C%22%2C%5Cn++bucket%3A+%5C%22openalex%5C%22%2C%5Cn%7D%29%3B%5Cn%5Cn%2F%2F+Log+data+about+each+object+found+under+the+%27data%2Fconcepts%2F%27+prefix%3A%5Cnfor+await+%28const+obj+of+s3client.listObjects%28%7B+prefix%3A+%5C%22data%2Fconcepts%2F%5C%22+%7D%29%29+%7B%5Cn++console.log%28obj%29%3B%5Cn%7D%22)
[![JSR Version](https://jsr.io/badges/@bradenmacdonald/s3-lite-client)](https://jsr.io/@bradenmacdonald/s3-lite-client)
[![JSR Downloads](https://jsr.io/badges/@bradenmacdonald/s3-lite-client/total-downloads)](https://jsr.io/@bradenmacdonald/s3-lite-client)
[![NPM Version](https://img.shields.io/npm/v/%40bradenmacdonald%2Fs3-lite-client)](https://www.npmjs.com/package/@bradenmacdonald/s3-lite-client)

This is a lightweight S3 (object storage) client for JavaScript runtimes (Deno, Node 22+, Bun, browsers, etc.). It is
designed to offer all the key features you may need, without bloat. It should work with any JavaScript runtime that
supports the `fetch` API, web streams API, and ES modules (ESM).

**Key features**:

- Has **no dependencies** and minifies to about 21kB (< 8 kB gzipped).
  - For comparison, the official `@aws-sdk/client-s3` has
    [56 dependencies and weighs 399 kB (94 kB gzipped)](https://bundlephobia.com/package/@aws-sdk/client-s3@3.758.0) at
    the time of writing.
- Works with any S3-compatible storage service: AWS S3, MinIO, Cloudflare R2, Backblaze B2, DigitalOcean Spaces,
  Supabase storage, etc.
- Implemented in TypeScript and fully typed.
- 100% MIT licensed, derived from the excellent [MinIO JavaScript Client](https://github.com/minio/minio-js).

## Supported functionality

- Authenticated or unauthenticated requests
- List objects: `for await (const object of client.listObjects(options)) { ... }`
  - Handles pagination transparently
  - Supports filtering using a prefix
  - Supports [grouping using a delimiter](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html)
    (use `client.listObjectsGrouped(...)`)
- Check if an object exists: `client.exists("key")`
- Get metadata about an object: `client.statObject("key")`
  - Can include custom headers in the request:
    `client.statObject("key", { headers: { 'x-amz-checksum-mode': 'ENABLED' } })`
- Download an object: `client.getObject("key", options)`
  - This just returns a standard HTTP `Response` object, so for large files, you can opt to consume the data as a stream
    (use the `.body` property).
- Download a partial object: `client.getPartialObject("key", options)`
  - Like `getObject`, this also supports streaming the response if you want to.
- Upload an object: `client.putObject("key", streamOrData, options)`
  - Can upload from a `string`, `Uint8Array`, or `ReadableStream`
  - Can split large uploads into multiple parts, and uploads a limited number of parts in parallel.
  - Uploads of 64MB or more are split into 64MB parts by default. Since S3 allows at most 10,000 parts, that supports
    objects up to 640GB; to upload something bigger, or to stream something bigger without passing `size`, pass a larger
    `partSize` (up to 5GB).
  - Can set custom headers, ACLs, and other metadata on the new object (example below).
- Copy an object: `client.copyObject({ sourceKey: "source", options }, "dest", options)`
  - Can copy between different buckets.
- Delete an object: `client.deleteObject("key")`
- Create pre-signed URLs: `client.presignedGetObject("key", options)` or
  `client.getPresignedUrl(method, "key", options)`
- Create pre-signed POST policy: `client.presignedPostObject("key", options)` for direct browser uploads
- Check if a bucket exists: `client.bucketExists("bucketName")`
- Create a new bucket: `client.makeBucket("bucketName")`
- Remove a bucket: `client.removeBucket("bucketName")`

## Installation

- Deno: `deno add @bradenmacdonald/s3-lite-client`
- Deno (no install): `import { S3Client } from "jsr:@bradenmacdonald/s3-lite-client@1.0.0";`
- NPM: `npm add @bradenmacdonald/s3-lite-client`
- Yarn: `yarn add jsr:@bradenmacdonald/s3-lite-client`
- pnpm: `pnpm add jsr:@bradenmacdonald/s3-lite-client`
- Bun: `bunx jsr add @bradenmacdonald/s3-lite-client`
- Browser:
  ```html
  <script type="module">
  import { S3Client } from "https://esm.sh/jsr/@bradenmacdonald/s3-lite-client@1.0.0";
  // Or:
  const { S3Client } = await import("https://esm.sh/jsr/@bradenmacdonald/s3-lite-client@1.0.0");
  </script>
  ```

## Usage Examples (Quickstart)

List data files from a public data set on Amazon S3:

```typescript
import { S3Client } from "@bradenmacdonald/s3-lite-client";

const s3client = new S3Client({
  endPoint: "https://s3.us-east-1.amazonaws.com",
  region: "us-east-1",
  bucket: "openalex",
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
  endPoint: "http://localhost:9000",
  region: "dev-region",
  bucket: "dev-bucket",
  accessKey: "AKIA_DEV",
  secretKey: "secretkey",
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

Creating a bucket on the S3 service of a local supabase development server:

```ts
const client = new S3Client({
  endPoint: "http://127.0.0.1:54321/storage/v1/s3",
  region: "local",
  accessKey: "paste from output of supabase start",
  secretKey: "paste from output of supabase start",
});
await client.makeBucket("my-bucket");
```

Set ACLs, Content-Type, custom metadata, etc. during upload:

```ts
await s3client.putObject("key", streamOrData, {
  metadata: {
    "x-amz-acl": "public-read",
    "x-amz-meta-custom": "value",
  },
});
```

Create a presigned POST policy for direct uploads from a browser:

```ts
// Create a presigned POST policy
const { url, fields } = await s3client.presignedPostObject("my-file.txt", {
  expirySeconds: 3600, // URL expires in 1 hour
  fields: {
    "Content-Type": "text/plain",
  },
});

// In the browser, use the policy for direct uploads:
const formData = new FormData();
// Add all required fields from the presigned POST
Object.entries(fields).forEach(([key, value]) => {
  formData.append(key, value);
});
// Add the file content
formData.append("file", fileInput.files[0]);

// Upload the object using the presigned POST
const response = await fetch(url, {
  method: "POST",
  body: formData,
});

if (response.ok) {
  console.log("File uploaded successfully!");
}
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
docker run --rm -e MINIO_ROOT_USER=AKIA_DEV -e MINIO_ROOT_PASSWORD=secretkey -e MINIO_REGION_NAME=dev-region -p 9000:9000 -p 9001:9001 --entrypoint /bin/sh minio/minio:RELEASE.2025-02-28T09-55-16Z -c 'mkdir -p /data/dev-bucket && minio server --console-address ":9001" /data'
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
