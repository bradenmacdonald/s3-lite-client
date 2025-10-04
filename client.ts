import { TransformChunkSizes } from "./transform-chunk-sizes.ts";
import * as errors from "./errors.ts";
import {
  isValidBucketName,
  isValidObjectName,
  isValidPort,
  makeDateLong,
  sanitizeETag,
  sha256digestHex,
  type Uint8Array_,
} from "./helpers.ts";
import { ObjectUploader } from "./object-uploader.ts";
import { presignPostV4, presignV4, signV4 } from "./signing.ts";
import { parse as parseXML } from "./xml-parser.ts";

export interface ClientOptions {
  /**
   * The full URL of the S3 endpoint. Can also be just the hostname (deprecated).
   * Examples: "https://s3.eu-west-1.amazonaws.com", "http://localhost:9000"
   */
  endPoint: string;
  accessKey?: string;
  secretKey?: string;
  /** If using temporary credentials, a session token is required. Otherwise you don't need this. */
  sessionToken?: string;
  /** Default bucket name, if not specified on individual requests */
  bucket?: string;
  /** Region to use, e.g. "us-east-1" */
  region: string;
  /** Use path-style requests, e.g. https://endpoint/bucket/object-key instead of https://bucket/object-key (default: true) */
  pathStyle?: boolean | undefined;
  /**
   * Whether to use HTTPS. Defaults to true unless http:// is explicitly specified in endPoint.
   * @deprecated Pass in a complete URL to `endPoint` instead, including 'https://' or 'http://'
   */
  useSSL?: boolean | undefined;
  /**
   * Port to use. Will be extracted from URL if provided, otherwise defaults to 80/443 based on protocol.
   * @deprecated Pass in a complete URL to `endPoint` instead, including a port number if needed.
   */
  port?: number | undefined;
  /**
   * Path prefix. Usually not required, but some API servers like Supabase S3 need this.
   * e.g. If docs say "S3 Storage URL: http://127.0.0.1:54321/storage/v1/s3" then pathPrefix is "/storage/v1/s3"
   *
   * @deprecated Pass in a complete URL to `endPoint` instead.
   */
  pathPrefix?: string;
}

/**
 * Standard Metadata (headers) that can be set when interacting with an object.
 * See https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
 */
const metadataKeys = [
  "Content-Type",
  "Cache-Control",
  "Content-Disposition",
  "Content-Encoding",
  "Content-Language",
  "Expires",
  "x-amz-checksum-sha256",
  "x-amz-grant-full-control",
  "x-amz-grant-read",
  "x-amz-grant-read-acp",
  "x-amz-grant-write-acp",
  "x-amz-server-side-encryption",
  "x-amz-storage-class",
  "x-amz-website-redirect-location",
  "x-amz-server-side-encryption-customer-algorithm",
  "x-amz-server-side-encryption-customer-key",
  "x-amz-server-side-encryption-customer-key-MD5",
  "x-amz-server-side-encryption-aws-kms-key-id",
  "x-amz-server-side-encryption-context",
  "x-amz-server-side-encryption-bucket-key-enabled",
  "x-amz-request-payer",
  "x-amz-tagging",
  "x-amz-object-lock-mode",
  "x-amz-object-lock-retain-until-date",
  "x-amz-object-lock-legal-hold",
  "x-amz-expected-bucket-owner",
] as const;

/**
 * Metadata (standard and custom) that can be set when uploading an object.
 *
 * Custom keys should be like "x-amz-meta-..."
 */
export type ObjectMetadata =
  & {
    "x-amz-acl"?:
      | "private"
      | "public-read"
      | "public-read-write"
      | "authenticated-read"
      | "aws-exec-read"
      | "bucket-owner-read"
      | "bucket-owner-full-control";
  }
  & { [K in typeof metadataKeys[number]]?: string }
  & { [customMetadata: `x-amz-meta-${string}`]: string };

/** Response Header Overrides
 * These parameters can be used with an authenticated or presigned get object request, to
 * override certain headers that will be sent with the response. These cannot be used with
 * anonymous requests (although some servers like MinIO do seem to allow it).
 * See https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
 */
export interface ResponseOverrideParams {
  "response-content-type"?: string;
  "response-content-language"?: string;
  "response-expires"?: string;
  "response-cache-control"?: string;
  "response-content-disposition"?: string;
  "response-content-encoding"?: string;
}

export interface UploadedObjectInfo {
  etag: string;
  versionId: string | null;
}

export interface CopiedObjectInfo extends UploadedObjectInfo {
  lastModified: Date;
  copySourceVersionId: string | null;
}

/** Details about an object as returned by a "list objects" operation */
export interface S3Object {
  type: "Object";
  key: string;
  lastModified: Date;
  etag: string;
  size: number;
}
/**
 * When listing objects and returning a delimited result (e.g. grouped by folders),
 * this represents a group of keys with a common prefix.
 * See https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html
 */
export interface CommonPrefix {
  type: "CommonPrefix";
  prefix: string;
}

/**
 * Additional properties provided by `statObject` compared to `listObjects`.
 */
export interface ObjectStatus extends S3Object {
  versionId: string | null;
  metadata: ObjectMetadata;
}

/** The minimum allowed part size for multi-part uploads. https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html */
const minimumPartSize = 5 * 1024 * 1024;
/** The maximum allowed part size for multi-part uploads. https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html */
const maximumPartSize = 5 * 1024 * 1024 * 1024;
/** The maximum allowed object size for multi-part uploads. https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html */
const maxObjectSize = 5 * 1024 * 1024 * 1024 * 1024;

/**
 * Interface for presigned POST policy conditions
 */
export type PolicyCondition = Record<string, unknown> | string[];

/**
 * Interface for the result of a presigned POST request
 */
export interface PresignedPostResult {
  /**
   * The URL to POST the form to
   */
  url: string;
  /**
   * The fields to include in the form
   */
  fields: Record<string, string>;
}

/**
 * Client for connecting to S3-compatible object storage services.
 */
export class Client {
  readonly host: string;
  readonly port: number;
  readonly protocol: "https:" | "http:";
  readonly accessKey?: string;
  readonly #secretKey: string;
  readonly sessionToken?: string;
  readonly defaultBucket: string | undefined;
  readonly region: string;
  readonly userAgent = "s3-lite-client";
  /** Use path-style requests, e.g. https://endpoint/bucket/object-key instead of https://bucket/object-key */
  readonly pathStyle: boolean;
  readonly pathPrefix?: string;

  constructor({ endPoint, useSSL, port, pathPrefix, ...params }: Readonly<ClientOptions>) {
    // Check if endpoint is a URL (starts with http:// or https://)
    if (/^https?:\/\//i.test(endPoint)) {
      if (useSSL !== undefined || port !== undefined || pathPrefix !== undefined) {
        throw new errors.InvalidArgumentError(`useSSL/port/pathPrefix cannot be specified if endPoint is a URL.`);
      }
      try {
        const url = new URL(endPoint);
        endPoint = url.hostname; // Now this is just the hostname
        useSSL = url.protocol === "https:";
        port = url.port ? parseInt(url.port, 10) : (useSSL ? 443 : 80);
        if (url.pathname && url.pathname !== "/") {
          pathPrefix = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
        }
      } catch {
        throw new errors.InvalidEndpointError(`Invalid endPoint URL: ${endPoint}`);
      }
    }

    // Now validate the extracted hostname
    if (typeof endPoint !== "string" || endPoint.length === 0) {
      throw new errors.InvalidEndpointError(`Invalid endPoint: ${endPoint}`);
    }

    // Default values if not specified.
    if (useSSL === undefined) {
      useSSL = true;
    }

    // Validate port
    if (port !== undefined && !isValidPort(port)) {
      throw new errors.InvalidArgumentError(`Invalid port: ${port}`);
    }

    // Validate credentials
    if (params.accessKey && !params.secretKey) {
      throw new errors.InvalidArgumentError(`If specifying access key, secret key must also be provided.`);
    }
    if (params.accessKey && params.accessKey.startsWith("ASIA") && !params.sessionToken) {
      throw new errors.InvalidArgumentError(`If specifying temporary access key, session token must also be provided.`);
    }

    const defaultPort = useSSL ? 443 : 80;
    this.port = port ?? defaultPort;
    this.host = endPoint.toLowerCase() + (this.port !== defaultPort ? `:${this.port}` : "");
    this.protocol = useSSL ? "https:" : "http:";
    this.accessKey = params.accessKey;
    this.#secretKey = params.secretKey ?? "";
    this.sessionToken = params.sessionToken;
    this.pathStyle = params.pathStyle ?? true; // Default path style is true
    this.pathPrefix = pathPrefix ?? "";
    this.defaultBucket = params.bucket;
    this.region = params.region;

    if (this.pathPrefix) {
      if (!this.pathStyle) {
        throw new errors.InvalidArgumentError(`pathPrefix is incompatible with pathStyle=false`);
      }
      if (!this.pathPrefix.startsWith("/")) {
        throw new errors.InvalidArgumentError(`pathPrefix should start with /`);
      }
      if (this.pathPrefix.endsWith("/")) {
        throw new errors.InvalidArgumentError(`pathPrefix should not end with /`);
      }
    }
  }

  /** Internal helper method to figure out which bucket name to use for a request */
  protected getBucketName(options: undefined | { bucketName?: string }): string {
    const bucketName = options?.bucketName ?? this.defaultBucket;
    if (bucketName === undefined || !isValidBucketName(bucketName)) {
      throw new errors.InvalidBucketNameError(bucketName ?? "");
    }
    return bucketName;
  }

  /**
   * Common code used for both "normal" requests and presigned URL requests
   */
  private buildRequestOptions(options: {
    objectName: string;
    bucketName?: string;
    headers?: Headers;
    query?: string | Record<string, string>;
  }): {
    headers: Headers;
    host: string;
    path: string;
  } {
    const bucketName = this.getBucketName(options);
    const host = this.pathStyle ? this.host : `${bucketName}.${this.host}`;
    const headers = options.headers ?? new Headers();
    headers.set("host", host);
    const queryAsString = typeof options.query === "object"
      ? new URLSearchParams(options.query).toString().replace("+", "%20") // Signing requires spaces become %20, never +
      : (options.query);
    const path =
      (this.pathStyle ? `${this.pathPrefix}/${bucketName}/${options.objectName}` : `/${options.objectName}`) +
      (queryAsString ? `?${queryAsString}` : "");
    return { headers, host, path };
  }

  /**
   * Make a single request to S3
   */
  public async makeRequest({ method, payload, ...options }: {
    method: "POST" | "GET" | "PUT" | "DELETE" | string;
    headers?: Headers;
    query?: string | Record<string, string>;
    objectName: string;
    bucketName?: string;
    /** The status code we expect the server to return */
    statusCode?: number;
    /** The request body */
    payload?: Uint8Array_ | string;
    /**
     * returnBody: We have to read the request body to avoid leaking resources.
     * So by default this method will read and ignore the body. If you actually
     * need it, set returnBody: true and this function won't touch it so that
     * the caller can read it.
     */
    returnBody?: boolean;
  }): Promise<Response> {
    const date = new Date();
    const { headers, host, path } = this.buildRequestOptions(options);
    const statusCode = options.statusCode ?? 200;

    if (
      method === "POST" || method === "PUT" || method === "DELETE"
    ) {
      if (payload === undefined) {
        payload = new Uint8Array();
      } else if (typeof payload === "string") {
        payload = new TextEncoder().encode(payload);
      }
      headers.set("Content-Length", String(payload.length));
    } else if (payload) {
      throw new Error(`Unexpected payload on ${method} request.`);
    }
    const sha256sum = await sha256digestHex(payload ?? new Uint8Array());
    headers.set("x-amz-date", makeDateLong(date));
    headers.set("x-amz-content-sha256", sha256sum);
    if (this.accessKey) {
      if (this.sessionToken) {
        headers.set("x-amz-security-token", this.sessionToken);
      }
      headers.set(
        "authorization",
        await signV4({
          headers,
          method,
          path,
          accessKey: this.accessKey,
          secretKey: this.#secretKey,
          region: this.region,
          date,
        }),
      );
    }

    const fullUrl = `${this.protocol}//${host}${path}`;

    const response = await fetch(fullUrl, {
      method,
      headers,
      body: payload,
    });

    if (response.status !== statusCode) {
      if (response.status >= 400) {
        const error = await errors.parseServerError(response);
        throw error;
      } else if (response.status === 301) {
        // Unfortunately we are not allowed to access the Location header to know what the new location is.
        throw new errors.ServerError(
          response.status,
          "UnexpectedRedirect",
          `The server unexpectedly returned a redirect response. With AWS S3, this usually means you need to use a ` +
            `region-specific endpoint like "s3.us-west-2.amazonaws.com" instead of "s3.amazonaws.com"`,
        );
      }
      throw new errors.ServerError(
        response.status,
        "UnexpectedStatusCode",
        `Unexpected response code from the server (expected ${statusCode}, got ${response.status} ${response.statusText}).`,
      );
    }
    if (!options.returnBody) {
      // Just read the body and ignore its contents, to avoid leaking resources.
      await response.body?.getReader().read();
    }
    return response;
  }

  /**
   * Delete a single object.
   *
   * You can also pass a versionId to delete a specific version of an object.
   */
  async deleteObject(
    objectName: string,
    options: { bucketName?: string; versionId?: string; governanceBypass?: boolean } = {},
  ) {
    const bucketName = this.getBucketName(options);
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(objectName);
    }

    const query: Record<string, string> = options.versionId ? { versionId: options.versionId } : {};
    const headers = new Headers();
    if (options.governanceBypass) {
      headers.set("X-Amz-Bypass-Governance-Retention", "true");
    }

    await this.makeRequest({
      method: "DELETE",
      bucketName,
      objectName,
      headers,
      query,
      statusCode: 204,
    });
  }

  /**
   * Check if an object with the specified key exists.
   */
  public async exists(
    objectName: string,
    options?: { bucketName?: string; versionId?: string; headers?: Record<string, string> },
  ): Promise<boolean> {
    try {
      await this.statObject(objectName, options);
      return true;
    } catch (err: unknown) {
      if (err instanceof errors.ServerError && err.statusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Get an object.
   *
   * Returns a standard HTTP Response object, which has many ways of consuming the response including
   * `.text()`, `.json()`, `.body` (ReadableStream), `.arrayBuffer()`, and `.blob()`.
   */
  public getObject(
    objectName: string,
    options?: {
      metadata?: ObjectMetadata;
      bucketName?: string;
      versionId?: string;
      responseParams?: ResponseOverrideParams;
    },
  ): Promise<Response> {
    return this.getPartialObject(objectName, { ...options, offset: 0, length: 0 });
  }

  /**
   * Stream a partial object, starting from the specified offset in bytes, up to the specified length in bytes.
   * A length of zero will return the rest of the object from the specified offset.
   * Pass a version UUID as "versionId" to download a specific version.
   *
   * Returns a standard HTTP Response object.
   */
  public async getPartialObject(
    objectName: string,
    { offset, length, ...options }: {
      offset: number;
      length: number;
      metadata?: ObjectMetadata;
      bucketName?: string;
      versionId?: string;
      responseParams?: ResponseOverrideParams;
    },
  ): Promise<Response> {
    const bucketName = this.getBucketName(options);
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(objectName);
    }

    const headers = new Headers(Object.entries(options.metadata ?? {}));
    let statusCode = 200; // Expected status code
    if (offset || length) {
      let range = "";
      if (offset) {
        range = `bytes=${+offset}-`;
      } else {
        range = "bytes=0-";
        offset = 0;
      }
      if (length) {
        range += `${(+length + offset) - 1}`;
      }
      headers.set("Range", range);
      statusCode = 206; // HTTP 206 "Partial Content"
    }

    // Create query string options
    const query: Record<string, string> = {
      ...options.responseParams,
      ...(options.versionId ? { versionId: options.versionId } : {}),
    };
    return await this.makeRequest({
      method: "GET",
      bucketName,
      objectName,
      headers,
      query,
      statusCode,
      returnBody: true,
    });
  }

  /**
   * Low-level method to generate a pre-signed URL.
   * @param method The HTTP method to use for the request
   * @param objectName The object name, e.g. "path/to/file.txt"
   * @param options Detailed options, such as expiry time for the pre-signed URL. Use expirySeconds to specify the expiry time; default is seven days.
   */
  getPresignedUrl(
    method: "GET" | "PUT" | "HEAD" | "DELETE",
    objectName: string,
    options: { bucketName?: string; parameters?: Record<string, string>; expirySeconds?: number; requestDate?: Date } =
      {},
  ): Promise<string> {
    if (!this.accessKey) {
      throw new errors.AccessKeyRequiredError();
    }
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(objectName);
    }
    const { headers, path } = this.buildRequestOptions({
      objectName,
      bucketName: options.bucketName,
      query: options.parameters,
    });
    const requestDate = options.requestDate ?? new Date();
    const expirySeconds = options.expirySeconds ?? 24 * 60 * 60 * 7; // default expiration is 7 days in seconds.

    return presignV4({
      protocol: this.protocol,
      headers,
      method,
      path,
      accessKey: this.accessKey,
      secretKey: this.#secretKey,
      sessionToken: this.sessionToken,
      region: this.region,
      date: requestDate,
      expirySeconds,
    });
  }

  /**
   * Generate a pre-signed GET request URL.
   *
   * Use options.expirySeconds to override the expiration time (default is 7 days)
   */
  presignedGetObject(
    objectName: string,
    options: {
      bucketName?: string;
      versionId?: string;
      responseParams?: ResponseOverrideParams;
      expirySeconds?: number;
      requestDate?: Date;
    } = {},
  ): Promise<string> {
    const { versionId, responseParams, ...otherOptions } = options;
    const parameters: Record<string, string> = {
      ...responseParams,
      ...(versionId ? { versionId } : {}),
    };
    return this.getPresignedUrl("GET", objectName, { parameters, ...otherOptions });
  }

  /**
   * List objects in the bucket, optionally filtered by the given key prefix.
   *
   * This returns a flat list; use listObjectsGrouped() for more advanced behavior.
   */
  public async *listObjects(
    options: {
      prefix?: string;
      bucketName?: string;
      /** Don't return more than this many results in total. Default: unlimited. */
      maxResults?: number;
      /**
       * How many keys to retrieve per HTTP request (default: 1000)
       * This is a maximum; sometimes fewer keys will be returned.
       * This will not affect the shape of the result, just its efficiency.
       */
      pageSize?: number;
    } = {},
  ): AsyncGenerator<S3Object, void, undefined> {
    for await (const result of this.listObjectsGrouped({ ...options, delimiter: "" })) {
      // Since we didn't specify a delimiter, listObjectsGrouped() should only return
      // actual object keys, not any CommonPrefix groupings.
      if (result.type === "Object") {
        yield result;
      } else {
        throw new Error(`Unexpected result from listObjectsGrouped(): ${result}`);
      }
    }
  }

  /**
   * List objects in the bucket, grouped based on the specified "delimiter".
   *
   * See https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html
   */
  public async *listObjectsGrouped(
    options: {
      delimiter: string;
      prefix?: string;
      bucketName?: string;
      /** Don't return more than this many results in total. Default: unlimited. */
      maxResults?: number;
      /**
       * How many keys to retrieve per HTTP request (default: 1000)
       * This is a maximum; sometimes fewer keys will be returned.
       * This will not affect the shape of the result, just its efficiency.
       */
      pageSize?: number;
    },
  ): AsyncGenerator<S3Object | CommonPrefix, void, undefined> {
    const bucketName = this.getBucketName(options);
    let continuationToken = "";
    const pageSize = options.pageSize ?? 1_000;
    if (pageSize < 1 || pageSize > 1_000) {
      throw new errors.InvalidArgumentError("pageSize must be between 1 and 1,000.");
    }
    let resultCount = 0; // Count the total number of results

    while (true) {
      // How many results to fetch in the next request:
      const maxKeys = options.maxResults ? Math.min(pageSize, options.maxResults - resultCount) : pageSize;
      if (maxKeys === 0) {
        return;
      }
      // Fetch the next page of results:
      const pageResponse = await this.makeRequest({
        method: "GET",
        bucketName,
        objectName: "",
        query: {
          "list-type": "2",
          prefix: options.prefix ?? "",
          delimiter: options.delimiter,
          "max-keys": String(maxKeys),
          ...(continuationToken ? { "continuation-token": continuationToken } : {}),
        },
        returnBody: true,
      });
      const responseText = await pageResponse.text();
      // Parse the response XML.
      // See https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html#API_ListObjectsV2_ResponseSyntax
      const root = parseXML(responseText).root;
      if (!root || root.name !== "ListBucketResult") {
        throw new Error(`Unexpected response: ${responseText}`);
      }
      // If a delimiter was specified, first return any common prefixes from this page of results:
      const prefixElements = root.children
        .filter((c) => c.name === "CommonPrefixes")
        .flatMap((c) => c.children);
      const toYield: Array<S3Object | CommonPrefix> = [];
      for (const prefixElement of prefixElements) {
        toYield.push({
          type: "CommonPrefix",
          prefix: prefixElement.content ?? "",
        });
        resultCount++;
      }
      // Now return all regular object keys found in the result:
      for (const objectElement of root.children.filter((c) => c.name === "Contents")) {
        toYield.push({
          type: "Object",
          key: objectElement.children.find((c) => c.name === "Key")?.content ?? "",
          etag: sanitizeETag(objectElement.children.find((c) => c.name === "ETag")?.content ?? ""),
          size: parseInt(objectElement.children.find((c) => c.name === "Size")?.content ?? "", 10),
          lastModified: new Date(objectElement.children.find((c) => c.name === "LastModified")?.content ?? "invalid"),
        });
        resultCount++;
      }
      // Now, interlace the commonprefixes and regular objects, so that the overall result stays sorted
      // in alphabetical order, instead of mixed by common prefixes first then other entries later.
      // This way guarantees consistent behavior regardless of page size.
      toYield.sort((a, b) => {
        const aStr = a.type === "Object" ? a.key : a.prefix;
        const bStr = b.type === "Object" ? b.key : b.prefix;
        return aStr > bStr ? 1 : aStr < bStr ? -1 : 0;
      });
      for (const entry of toYield) {
        yield entry;
      }
      const isTruncated = root.children.find((c) => c.name === "IsTruncated")?.content === "true";
      if (isTruncated) {
        // There are more results.
        const nextContinuationToken = root.children.find((c) => c.name === "NextContinuationToken")?.content;
        if (!nextContinuationToken) {
          throw new Error("Unexpectedly missing continuation token, but server said there are more results.");
        }
        continuationToken = nextContinuationToken;
      } else {
        // That's it, no more results.
        return;
      }
    }
  }

  /**
   * Upload an object
   */
  async putObject(
    objectName: string,
    streamOrData: ReadableStream<Uint8Array> | Uint8Array | string,
    options?: {
      metadata?: ObjectMetadata;
      size?: number;
      bucketName?: string;
      /**
       * For large uploads, split them into parts of this size.
       * Default: 64MB if object size is known, 500MB if total object size is unknown.
       * This is a minimum; larger part sizes may be required for large uploads or if the total size is unknown.
       */
      partSize?: number;
    },
  ): Promise<UploadedObjectInfo> {
    const bucketName = this.getBucketName(options);
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(objectName);
    }

    // Prepare a readable stream for the upload:
    let size: number | undefined;
    let stream: ReadableStream<Uint8Array>;
    if (typeof streamOrData === "string") {
      // Convert to binary using UTF-8
      const binaryData = new TextEncoder().encode(streamOrData);
      if (typeof ReadableStream.from !== "undefined") {
        stream = ReadableStream.from([binaryData]);
      } else {
        // ReadableStream.from is not yet supported by some runtimes :/
        // https://github.com/oven-sh/bun/issues/3700
        // https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/from_static#browser_compatibility
        // deno-fmt-ignore
        stream = new ReadableStream({ start(c) { c.enqueue(binaryData); c.close(); } });
      }
      size = binaryData.length;
    } else if (streamOrData instanceof Uint8Array) {
      if (typeof ReadableStream.from !== "undefined") {
        stream = ReadableStream.from([streamOrData]);
      } else {
        // deno-fmt-ignore
        stream = new ReadableStream({ start(c) { c.enqueue(streamOrData); c.close(); } });
      }
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
      if (typeof options.size !== "number" || options.size < 0 || isNaN(options.size)) {
        throw new errors.InvalidArgumentError(
          `invalid size specified: ${options.size}`,
        );
      } else {
        size = options.size;
      }
    }

    // Determine the part size, if we may need to do a multi-part upload.
    const partSize = options?.partSize ?? this.calculatePartSize(size);
    if (partSize < minimumPartSize) {
      throw new errors.InvalidArgumentError(`Part size should be greater than 5MB`);
    } else if (partSize > maximumPartSize) {
      throw new errors.InvalidArgumentError(`Part size should be less than 6MB`);
    }

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
      metadata: options?.metadata ?? {},
    });
    // stream => chunker => uploader
    await stream.pipeThrough(chunker).pipeTo(uploader);
    return uploader.getResult();
  }

  /**
   * Calculate part size given the object size. Part size will be at least this.partSize.
   *
   * Per https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html we have to
   * stick to the following rules:
   * - part size between 5MB (this.maximumPartSize) and 5GB (this.maxObjectSize)
   *   (the final part can be smaller than 5MB however)
   * - maximum of 10,000 parts per upload
   * - maximum object size of 5TB
   */
  protected calculatePartSize(size: number | undefined): number {
    if (size === undefined) {
      // If we don't know the total size (e.g. we're streaming data), assume it's
      // the largest allowed object size, so we can guarantee the upload works
      // regardless of the total size.
      size = maxObjectSize;
    }
    if (size > maxObjectSize) {
      throw new TypeError(`size should not be more than ${maxObjectSize}`);
    }
    let partSize = 64 * 1024 * 1024; // Start with 64MB
    while (true) {
      // If partSize is big enough to accomodate the object size, then use it.
      if ((partSize * 10_000) > size) {
        return partSize;
      }
      // Try part sizes as 64MB, 80MB, 96MB etc.
      partSize += 16 * 1024 * 1024;
    }
  }

  /**
   * Get detailed information about an object.
   */
  public async statObject(
    objectName: string,
    options?: {
      bucketName?: string;
      versionId?: string;
      /**
       * Additional headers to include in the request
       */
      headers?: Record<string, string>;
    },
  ): Promise<ObjectStatus> {
    const bucketName = this.getBucketName(options);
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(objectName);
    }
    const query: Record<string, string> = {};
    if (options?.versionId) {
      query.versionId = options.versionId;
    }

    const response = await this.makeRequest({
      method: "HEAD",
      bucketName,
      objectName,
      query,
      // Add custom headers if provided
      headers: new Headers(options?.headers),
    });

    const metadata: ObjectMetadata = {};
    for (const header of metadataKeys) {
      if (response.headers.has(header)) {
        metadata[header] = response.headers.get(header) as string;
      }
    }
    // Also add in custom metadata
    response.headers.forEach((_value, key) => {
      if (key.startsWith("x-amz-meta-")) {
        metadata[key as `x-amz-meta-${string}`] = response.headers.get(key) as string;
      }
    });

    return {
      type: "Object",
      key: objectName,
      size: parseInt(response.headers.get("content-length") ?? "", 10),
      metadata,
      lastModified: new Date(response.headers.get("Last-Modified") ?? "error: missing last modified"),
      versionId: response.headers.get("x-amz-version-id") || null,
      etag: sanitizeETag(response.headers.get("ETag") ?? ""),
    };
  }

  /**
   * Copy an object into this bucket
   */
  public async copyObject(
    source: { sourceBucketName?: string; sourceKey: string; sourceVersionId?: string },
    objectName: string,
    options?: {
      bucketName?: string;
      /** Metadata for the new object. If not specified, metadata will be copied from the source. */
      metadata?: ObjectMetadata;
    },
  ): Promise<CopiedObjectInfo> {
    const bucketName = this.getBucketName(options);
    const sourceBucketName = source.sourceBucketName ?? bucketName;
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(objectName);
    }

    // The "x-amz-copy-source" header is like "bucket/objectkey" with an optional version ID.
    // e.g. "awsexamplebucket/reports/january.pdf?versionId=QUpfdndhfd8438MNFDN93jdnJFkdmqnh893"
    let xAmzCopySource = `${sourceBucketName}/${source.sourceKey}`;
    if (source.sourceVersionId) xAmzCopySource += `?versionId=${source.sourceVersionId}`;

    const headers = new Headers(options?.metadata);
    if (options?.metadata !== undefined) {
      headers.set("x-amz-metadata-directive", "REPLACE");
    }
    headers.set("x-amz-copy-source", xAmzCopySource);

    const response = await this.makeRequest({ method: "PUT", bucketName, objectName, headers, returnBody: true });

    const responseText = await response.text();
    // Parse the response XML.
    // See https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html#API_CopyObject_ResponseSyntax
    const root = parseXML(responseText).root;
    if (!root || root.name !== "CopyObjectResult") {
      throw new Error(`Unexpected response: ${responseText}`);
    }
    const etagString = root.children.find((c) => c.name === "ETag")?.content ?? "";
    const lastModifiedString = root.children.find((c) => c.name === "LastModified")?.content;
    if (lastModifiedString === undefined) {
      throw new Error("Unable to find <LastModified>...</LastModified> from the server.");
    }

    return {
      copySourceVersionId: response.headers.get("x-amz-copy-source-version-id") || null,
      etag: sanitizeETag(etagString),
      lastModified: new Date(lastModifiedString),
      versionId: response.headers.get("x-amz-version-id") || null,
    };
  }

  /** Check if a bucket exists */
  public async bucketExists(bucketName: string): Promise<boolean> {
    try {
      const objects = this.listObjects({ bucketName });
      // We don't need to fully list the objects, just check if we can start listing
      await objects.next();
      return true;
    } catch (err: unknown) {
      if (err instanceof errors.ServerError && err.statusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  /** Create a new bucket */
  public async makeBucket(bucketName: string): Promise<void> {
    await this.makeRequest({
      method: "PUT",
      bucketName: this.getBucketName({ bucketName }),
      objectName: "",
      statusCode: 200,
    });
  }

  /** Delete a bucket (must be empty) */
  public async removeBucket(bucketName: string): Promise<void> {
    await this.makeRequest({
      method: "DELETE",
      bucketName: this.getBucketName({ bucketName }),
      objectName: "",
      statusCode: 204,
    });
  }

  /**
   * Creates a presigned POST policy that can be used to allow browser/client uploads directly to S3.
   * This is equivalent to AWS SDK's createPresignedPost functionality.
   *
   * @param objectName - Object name for which the presigned URL is generated
   * @param options - Additional options
   * @returns An object with url and fields that can be used to construct a form for direct uploads
   */
  presignedPostObject(
    objectName: string,
    options: {
      /**
       * Bucket name to use for this operation. If not specified, the default bucket name will be used.
       */
      bucketName?: string;
      /**
       * Expiry time in seconds for the presigned URL. Default is 1 hour (3600 seconds).
       */
      expirySeconds?: number;
      /**
       * Date when the presigned URL becomes valid. Default is now.
       */
      requestDate?: Date;
      /**
       * Additional policy conditions to apply.
       * See: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html
       */
      conditions?: PolicyCondition[];
      /**
       * Additional form fields to include in the policy and the result.
       */
      fields?: Record<string, string>;
    } = {},
  ): Promise<PresignedPostResult> {
    if (!isValidObjectName(objectName)) {
      throw new errors.InvalidObjectNameError(objectName);
    }

    const bucketName = this.getBucketName(options);
    if (!bucketName) {
      throw new Error(
        "Bucket name is required for presignedPost, but none was provided either to this method nor to the client constructor",
      );
    }

    // Build request options
    const requestDate = options.requestDate || new Date();
    const expirySeconds = options.expirySeconds ?? 3600; // Default 1 hour

    return presignPostV4({
      protocol: this.protocol,
      host: this.host,
      bucket: bucketName,
      objectKey: objectName,
      accessKey: this.accessKey || "",
      secretKey: this.#secretKey || "",
      region: this.region,
      date: requestDate,
      expirySeconds,
      conditions: options.conditions,
      fields: options.fields,
    });
  }
}
