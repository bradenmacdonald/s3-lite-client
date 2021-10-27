import { TransformChunkSizes } from "./transform-chunk-sizes.ts";
import { readableStreamFromIterable } from "./deps.ts";
import * as errors from "./errors.ts";
import { isValidBucketName, isValidObjectName, isValidPort, makeDateLong, sha256digestHex } from "./helpers.ts";
import { ObjectUploader } from "./object-uploader.ts";
import { signV4 } from "./signing.ts";

export interface ClientOptions {
  /** Hostname of the endpoint. Not a URL, just the hostname with no protocol or port. */
  endPoint: string;
  accessKey: string;
  secretKey: string;
  useSSL?: boolean | undefined;
  port?: number | undefined;
  /** Default bucket name, if not specified on individual requests */
  bucket?: string;
  /** Region to use, e.g. "us-east-1" */
  region: string;
  // transport
  // sessionToken?: string | undefined;
  partSize?: number | undefined;
  /** Use path-style requests, e.g. https://endpoint/bucket/object-key instead of https://bucket/object-key (default: true) */
  pathStyle?: boolean | undefined;
}

/**
 * Metadata that can be set when uploading an object.
 */
export type ItemBucketMetadata = {
  // See https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
  ["Content-Type"]?: string;
  ["Cache-Control"]?: string;
  ["Content-Disposition"]?: string;
  ["Content-Encoding"]?: string;
  ["Content-Language"]?: string;
  ["Expires"]?: string;
  ["x-amz-acl"]?: string;
  ["x-amz-grant-full-control"]?: string;
  ["x-amz-grant-read"]?: string;
  ["x-amz-grant-read-acp"]?: string;
  ["x-amz-grant-write-acp"]?: string;
  ["x-amz-server-side-encryption"]?: string;
  ["x-amz-storage-class"]?: string;
  ["x-amz-website-redirect-location"]?: string;
  ["x-amz-server-side-encryption-customer-algorithm"]?: string;
  ["x-amz-server-side-encryption-customer-key"]?: string;
  ["x-amz-server-side-encryption-customer-key-MD5"]?: string;
  ["x-amz-server-side-encryption-aws-kms-key-id"]?: string;
  ["x-amz-server-side-encryption-context"]?: string;
  ["x-amz-server-side-encryption-bucket-key-enabled"]?: string;
  ["x-amz-request-payer"]?: string;
  ["x-amz-tagging"]?: string;
  ["x-amz-object-lock-mode"]?: string;
  ["x-amz-object-lock-retain-until-date"]?: string;
  ["x-amz-object-lock-legal-hold"]?: string;
  ["x-amz-expected-bucket-owner"]?: string;
  // Custom keys should be like "X-Amz-Meta-..."
} & { [key: string]: string };

export interface UploadedObjectInfo {
  etag: string;
  versionId: string | null;
}

export class Client {
  readonly host: string;
  readonly port: number;
  readonly protocol: "https:" | "http:";
  readonly accessKey: string;
  readonly #secretKey: string;
  readonly defaultBucket: string | undefined;
  readonly region: string;
  readonly userAgent = "deno-s3-lite-client";
  /** Use path-style requests, e.g. https://endpoint/bucket/object-key instead of https://bucket/object-key */
  readonly pathStyle: boolean;
  readonly partSize: number;
  readonly maximumPartSize = 5 * 1024 * 1024 * 1024;
  readonly maxObjectSize = 5 * 1024 * 1024 * 1024 * 1024;

  constructor(params: ClientOptions) {
    // Default values if not specified.
    if (params.useSSL === undefined) {
      params.useSSL = true;
    }
    // Validate input params.
    if (
      typeof params.endPoint !== "string" || params.endPoint.length === 0 ||
      params.endPoint.indexOf("/") !== -1
    ) {
      throw new errors.InvalidEndpointError(
        `Invalid endPoint : ${params.endPoint}`,
      );
    }
    if (params.port !== undefined && !isValidPort(params.port)) {
      throw new errors.InvalidArgumentError(`Invalid port : ${params.port}`);
    }

    this.port = params.port ?? (params.useSSL ? 443 : 80);
    this.host = params.endPoint.toLowerCase() +
      (params.port ? `:${params.port}` : "");
    this.protocol = params.useSSL ? "https:" : "http:";
    this.accessKey = params.accessKey;
    this.#secretKey = params.secretKey;
    this.pathStyle = params.pathStyle ?? true; // Default path style is true
    this.defaultBucket = params.bucket;
    this.region = params.region;

    this.partSize = params.partSize ?? 64 * 1024 * 1024;
    if (this.partSize < 5 * 1024 * 1024) {
      throw new errors.InvalidArgumentError(
        `Part size should be greater than 5MB`,
      );
    }
    if (this.partSize > this.maximumPartSize) {
      throw new errors.InvalidArgumentError(
        `Part size should be less than 5GB`,
      );
    }
  }

  protected getBucketName(options: undefined | { bucketName?: string }) {
    const bucketName = options?.bucketName ?? this.defaultBucket;
    if (bucketName === undefined || !isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(
        `Invalid bucket name: ${bucketName}`,
      );
    }
    return bucketName;
  }

  // makeRequest is the primitive used by the apis for making S3 requests.
  // payload can be empty string in case of no payload.
  // statusCode is the expected statusCode. If response.statusCode does not match
  // we parse the XML error and call the callback with the error message.
  // A valid region is passed by the calls - listBuckets, makeBucket and
  // getBucketRegion.
  /**
   * Make a single request to S3
   */
  public async makeRequest(options: {
    method: "POST" | "GET" | "PUT" | "DELETE" | string;
    headers?: Record<string, string>;
    query: string;
    objectName: string;
    bucketName?: string;
    /** The status code we expect the server to return */
    statusCode?: number;
  }, payload?: Uint8Array): Promise<Response> {
    const date = new Date();
    const bucketName = this.getBucketName(options);
    const headers = new Headers(options.headers ?? {});
    const host = this.pathStyle ? this.host : `${bucketName}.${this.host}`;
    const path = (this.pathStyle ? `/${bucketName}/${options.objectName}` : `/${options.objectName}`) +
      (options.query ? `?${options.query}` : "");
    const statusCode = options.statusCode ?? 200;

    if (
      options.method === "POST" || options.method === "PUT" ||
      options.method === "DELETE"
    ) {
      if (payload === undefined) {
        throw new errors.InvalidArgumentError(
          "makeRequest: payload is missing",
        );
      }
      headers.set("Content-Length", String(payload.length));
    }
    const sha256sum = await sha256digestHex(payload ?? new Uint8Array());
    headers.set("host", host);
    headers.set("x-amz-date", makeDateLong(date));
    headers.set("x-amz-content-sha256", sha256sum);
    headers.set(
      "authorization",
      await signV4({
        headers,
        method: options.method,
        path: options.objectName,
        accessKey: this.accessKey,
        secretKey: this.#secretKey,
        region: this.region,
        date,
      }),
    );

    const fullUrl = `${this.protocol}//${host}${path}`;

    const response = await fetch(fullUrl, {
      method: options.method,
      headers,
      body: payload,
    });
    if (response.status !== statusCode) {
      if (response.status >= 400) {
        const error = await errors.parseServerError(response);
        throw error;
      } else {
        throw new errors.S3Error(
          response.status,
          "UnexpectedStatusCode",
          `Unexpected response code from the server (expected ${statusCode}, got ${response.status} ${response.statusText}).`,
        );
      }
    }
    return response;
  }

  async putObject(
    objectName: string,
    streamOrData: ReadableStream<Uint8Array> | Uint8Array | string,
    options?: {
      metaData?: ItemBucketMetadata;
      size?: number;
      bucketName?: string;
    },
  ): Promise<UploadedObjectInfo> {
    const bucketName = this.getBucketName(options);
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(
        `Invalid object name: ${objectName}`,
      );
    }

    // Prepare a readable stream for the upload:
    let size: number | undefined;
    let stream: ReadableStream<Uint8Array>;
    if (typeof streamOrData === "string") {
      // Convert to binary using UTF-8
      const binaryData = new TextEncoder().encode(streamOrData);
      stream = readableStreamFromIterable([binaryData]);
      size = binaryData.length;
    } else if (streamOrData instanceof Uint8Array) {
      stream = readableStreamFromIterable([streamOrData]);
      size = streamOrData.byteLength;
    } else if (streamOrData instanceof ReadableStream) {
      stream = streamOrData;
    } else {
      throw new errors.InvalidArgumentError(
        `Invalid stream/data type provided.`,
      );
    }

    // Validate the size parameter
    if (options?.size !== undefined) {
      if (size !== undefined && options?.size !== size) {
        throw new errors.InvalidArgumentError(
          `size was specified (${options.size}) but doesn't match auto-detected size (${size}).`,
        );
      }
      if (typeof size !== "number" || size < 0 || isNaN(size)) {
        throw new errors.InvalidArgumentError(
          `invalid size specified: ${options.size}`,
        );
      } else {
        size = options.size;
      }
    }

    // Get the part size and forward that to the BlockStream. Default to the
    // largest block size possible if necessary.
    if (size === undefined) {
      size = this.maxObjectSize;
    }
    const partSize = this.calculatePartSize(size);

    // s3 requires that all non-end chunks be at least `this.partSize`,
    // so we chunk the stream until we hit either that size or the end before
    // we flush it to s3.
    const chunker = new TransformChunkSizes(partSize);

    // This is a Writable stream that can be written to in order to upload
    // to the specified bucket and object automatically.
    const uploader = new ObjectUploader({
      client: this,
      bucketName,
      objectName,
      partSize,
      metaData: options?.metaData ?? {},
    });
    // stream => chunker => uploader
    stream.pipeThrough(chunker).pipeTo(uploader);
    return await uploader.uploadDone;
  }

  /** Calculate part size given the object size. Part size will be at least this.partSize */
  protected calculatePartSize(size: number) {
    if (size > this.maxObjectSize) {
      throw new TypeError(`size should not be more than ${this.maxObjectSize}`);
    }
    // if (this.overRidePartSize) {
    //   return this.partSize
    // }
    let partSize = this.partSize;
    while (true) {
      // If partSize is big enough to accomodate the object size, then use it.
      if ((partSize * 10_000) > size) {
        return partSize;
      }
      // Try part sizes as 64MB, 80MB, 96MB etc.
      partSize += 16 * 1024 * 1024;
    }
  }

  /** Initiate a new multipart upload request. */
  public async initiateNewMultipartUpload(
    options: {
      bucketName?: string;
      objectName: string;
      metaData?: ItemBucketMetadata;
    },
  ): Promise<{ uploadId: string }> {
    const bucketName = this.getBucketName(options);
    if (!isValidObjectName(options.objectName)) {
      throw new errors.InvalidObjectNameError(
        `Invalid object name: ${options.objectName}`,
      );
    }
    const method = "POST";
    const headers = { ...options.metaData };
    const query = "uploads";
    const response = await this.makeRequest({
      method,
      bucketName,
      objectName: options.objectName,
      query,
      headers,
    });
    console.log(response.text());
    throw new Error("TODO: parse response and return uploadId");
  }
}
