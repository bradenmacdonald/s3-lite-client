# deno-s3-lite-client

A very lightweight S3 client for Deno. Has no dependencies outside of the Deno standard library. MIT licensed.

It is derived from the excellent [MinIO JavaScript Client](https://github.com/minio/minio-js). Note however that only a
tiny subset of that client's functionality has been implemented.

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
