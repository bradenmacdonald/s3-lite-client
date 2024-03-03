/**
 * @module
 * A lightweight client for connecting to S3-compatible object storage services.
 */

export { Client as S3Client } from "./client.ts";

/**
 * Namespace for all errors that can be thrown by S3Client
 */
export * as S3Errors from "./errors.ts";
