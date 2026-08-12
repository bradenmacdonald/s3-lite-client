/**
 * @module
 * All the errors which can be thrown by this S3 client.
 * Every error is a subclass of S3Error.
 */

import { childText, parse as parseXML } from "./xml-parser.ts";

/**
 * Base class for all errors raised by this S3 client.
 */
export class S3Error extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    // Without this, every subclass would report its name as the unhelpful "Error".
    // If the names have been mangled during minification, we'll just use `S3Error`.
    this.name = new.target.name.endsWith("Error") ? new.target.name : "S3Error";
  }
}

/**
 * An argument or configuration parameter was invalid.
 */
export class InvalidArgumentError extends S3Error {}

/**
 * InvalidEndpointError is generated when an invalid end point value is
 * provided which does not follow domain standards.
 */
export class InvalidEndpointError extends S3Error {}

/**
 * InvalidBucketNameError is generated when an invalid bucket name is
 * provided which does not follow AWS S3 specifications.
 * http://docs.aws.amazon.com/AmazonS3/latest/dev/BucketRestrictions.html
 */
export class InvalidBucketNameError extends S3Error {
  constructor(public readonly bucketName: string) {
    super(`Invalid bucket name: ${bucketName}`);
  }
}

/**
 * InvalidObjectNameError is generated when an invalid object name is
 * provided which does not follow AWS S3 specifications.
 * http://docs.aws.amazon.com/AmazonS3/latest/dev/UsingMetadata.html
 */
export class InvalidObjectNameError extends S3Error {
  constructor(public readonly objectName: string) {
    super(`Invalid object name: ${objectName}`);
  }
}

/** The request cannot be made without an access key to authenticate it */
export class AccessKeyRequiredError extends S3Error {
  constructor() {
    super("accessKey is required");
  }
}

/** The request cannot be made without a secret key to authenticate it */
export class SecretKeyRequiredError extends S3Error {
  constructor() {
    super("secretKey is required");
  }
}

/** The expiration time for the request is invalid */
export class InvalidExpiryError extends S3Error {
  constructor() {
    super("expirySeconds cannot be less than 1 second or more than 7 days");
  }
}

/** Any error thrown by the server */
export class ServerError extends S3Error {
  readonly key: string | undefined;
  readonly bucketName: string | undefined;
  readonly resource: string | undefined;
  readonly region: string | undefined;

  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    otherData: { key?: string; bucketName?: string; resource?: string; region?: string } = {},
  ) {
    super(message);
    this.key = otherData.key;
    this.bucketName = otherData.bucketName;
    this.resource = otherData.resource;
    this.region = otherData.region;
  }
}

/** Helper function to parse an error returned by the S3 server. */
export async function parseServerError(response: Response): Promise<ServerError> {
  try {
    const errorRoot = parseXML(await response.text());
    if (errorRoot?.name !== "Error") {
      throw new Error("Invalid root, expected <Error>");
    }
    return new ServerError(
      response.status,
      childText(errorRoot, "Code") ?? "UnknownErrorCode",
      childText(errorRoot, "Message") ?? "The error message could not be determined.",
      {
        key: childText(errorRoot, "Key"),
        bucketName: childText(errorRoot, "BucketName"),
        resource: childText(errorRoot, "Resource"), // e.g. the object key
        region: childText(errorRoot, "Region"),
      },
    );
  } catch {
    return new ServerError(
      response.status,
      "UnrecognizedError",
      `Error: Unexpected response code ${response.status} ${response.statusText}. Unable to parse response as XML.`,
    );
  }
}
