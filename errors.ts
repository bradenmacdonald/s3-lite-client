/**
 * Base class for all errors raised by this S3 client.
 */
export class DenoS3LiteClientError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * An argument or configuration parameter was invalid.
 */
export class InvalidArgumentError extends DenoS3LiteClientError {}

/**
 * InvalidEndpointError is generated when an invalid end point value is
 * provided which does not follow domain standards.
 */
export class InvalidEndpointError extends DenoS3LiteClientError {}

/**
 * InvalidBucketNameError is generated when an invalid bucket name is
 * provided which does not follow AWS S3 specifications.
 * http://docs.aws.amazon.com/AmazonS3/latest/dev/BucketRestrictions.html
 */
export class InvalidBucketNameError extends DenoS3LiteClientError {}

/**
 * InvalidObjectNameError is generated when an invalid object name is
 * provided which does not follow AWS S3 specifications.
 * http://docs.aws.amazon.com/AmazonS3/latest/dev/UsingMetadata.html
 */
export class InvalidObjectNameError extends DenoS3LiteClientError {}

/** The request cannot be made without an access key to authenticate it */
export class AccessKeyRequiredError extends DenoS3LiteClientError {}

/** The request cannot be made without a secret key to authenticate it */
export class SecretKeyRequiredError extends DenoS3LiteClientError {}

/** Any error thrown by the server */
export class S3Error extends DenoS3LiteClientError {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}
