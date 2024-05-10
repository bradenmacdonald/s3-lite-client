/**
 * @module
 * A lightweight client for connecting to S3-compatible object storage services.
 */

export {
  Client as S3Client,
  type ClientOptions as S3ClientOptions,
  type CommonPrefix as S3CommonPrefix,
  type CopiedObjectInfo as S3CopiedObjectInfo,
  type ObjectMetadata as S3ObjectMetadata,
  type ObjectStatus as S3ObjectStatus,
  type ResponseOverrideParams as S3ResponseOverrideParams,
  type S3Object,
  type UploadedObjectInfo as S3UploadedObjectInfo,
} from "./client.ts";
export * as S3Errors from "./errors.ts";
