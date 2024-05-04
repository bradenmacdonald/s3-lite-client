/**
 * @module
 * A lightweight client for connecting to S3-compatible object storage services.
 */

export { Client as S3Client, type ClientOptions as S3ClientOptions } from "./client.ts";
export * as S3Errors from "./errors.ts";
