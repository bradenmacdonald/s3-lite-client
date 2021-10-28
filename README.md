# deno-s3-lite-client

A very lightweight S3 client for Deno. Has no dependencies outside of the Deno standard library. MIT licensed.

It is derived from the excellent [MinIO JavaScript Client](https://github.com/minio/minio-js). Note however that only a
tiny subset of that client's functionality has been implemented.

Supported functionality:

- List objects: `for await (const object of client.listObjects(options)) { ... }`
  - Handles pagination transparently
  - Supports filtering using a prefix
  - Supports [grouping using a delimiter](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html)
    (use `client.listObjectsGrouped(...)`)
- Download an object: `client.getObject("key", options)`
  - Supports streaming the response
- Download a partial object: `client.getPartialObject("key", options)`
  - Supports streaming the response
- Upload an object: `client.putObject("key", streamOrData, options)`
  - Can upload from a `string`, `Uint8Array`, or `ReadableStream`
  - Can split large uploads into multiple parts and uploads parts in parallel

## Usage example

```typescript
import { S3Client } from "https://raw.githubusercontent.com/bradenmacdonald/deno-s3-lite-client/main/mod.ts";

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
```

For more examples, check out the tests in [`integration.ts`](./integration.ts)

## Developer notes

To run the tests, please use:

```sh
deno lint && deno test
```

To format the code, use:

```sh
deno fmt --options-line-width 120
```

To run the integration tests, first start MinIO with this command:

```sh
docker run --rm -e MINIO_ROOT_USER=AKIA_DEV -e MINIO_ROOT_PASSWORD=secretkey -e MINIO_REGION_NAME=dev-region -p 9000:9000 -p 9001:9001 --entrypoint /bin/sh minio/minio:RELEASE.2021-10-23T03-28-24Z -c 'mkdir -p /data/dev-bucket && minio server --console-address ":9001" /data'
```

Then while MinIO is running, run

```sh
deno test --allow-net integration.ts
```

To debug what MinIO is seeing, run these two commands:

```sh
mc alias set localdebug http://localhost:9000 AKIA_DEV secretkey
mc admin trace --verbose --all localdebug
```
