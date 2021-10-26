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
