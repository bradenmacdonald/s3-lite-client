/**
 * For TypeScript 5.7+ we have to write `Uint8Array<ArrayBuffer>` instead of
 * `Uint8Array` or we'll get type errors in various places where arrays based
 * on SharedArrayBuffer are not allowed. This type alias will work both pre-
 * and post- TypeScript 5.7. Yes this is annoying.
 */
export type Uint8Array_ = ReturnType<Uint8Array["slice"]>;

export function isValidPort(port: number) {
  // verify if port is a number.
  if (typeof port !== "number" || isNaN(port)) {
    return false;
  }
  // Verify if port is in range.
  return port >= 1 && port <= 65535;
}

/**
 * Validate a bucket name.
 *
 * This is pretty minimal, general validation. We let the remote
 * S3 server do detailed validation.
 *
 * https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html
 */
export function isValidBucketName(bucket: string): boolean {
  if (typeof bucket !== "string") {
    return false;
  }
  // Generally the bucket name length limit is 63, but
  // "Before March 1, 2018, buckets created in the US East (N. Virginia)
  //  Region could have names that were up to 255 characters long"
  if (bucket.length > 255) {
    return false;
  }
  // "Bucket names must not contain two adjacent periods."
  if (bucket.includes("..")) {
    return false;
  }
  // "Bucket names must begin and end with a letter or number."
  // "Bucket names can consist only of lowercase letters, numbers,
  //  periods (.), and hyphens (-)."
  // -> Most S3 servers require lowercase bucket names but some allow
  // uppercase (Backblaze, AWS us-east buckets created before 2018)
  return Boolean(bucket.match(/^[a-zA-Z0-9][a-zA-Z0-9.-]+[a-zA-Z0-9]$/));
}

/**
 * check if objectName is a valid object name
 * http://docs.aws.amazon.com/AmazonS3/latest/dev/UsingMetadata.html
 */
export const isValidObjectName = (n: string) => isValidPrefix(n) && n.length > 0;

// check if prefix is valid
export function isValidPrefix(prefix: string) {
  if (typeof prefix !== "string") return false;
  if (prefix.length > 1024) return false;
  // A lone surrogate cannot be represented in UTF-8, so such a key could never reach the server as
  // written. Reject it here, rather than letting it be silently mangled into U+FFFD or throw a
  // URIError from deep inside the URL encoding.
  if (!prefix.isWellFormed()) return false;
  return true;
}

/**
 * Convert some binary data to a hex string
 */
export function bin2hex(binary: Uint8Array) {
  return Array.from(binary).map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Strip the quotes that S3 wraps around an ETag value.
 *
 * How the quotes are written depends on where the ETag came from: an `ETag` response header holds
 * literal double quotes (`"abc"`), while an `<ETag>` read out of an XML response body is still
 * escaped (`&#34;abc&#34;`), because our XML parser only decodes `&lt;`, `&gt;` and `&amp;`.
 *
 * Only one quote is removed from each end, and only these three spellings are recognized: `"`,
 * `&quot;` and `&#34;`. Any quote in the middle of the value is left alone.
 *
 * @param etag the raw ETag, or undefined if the server didn't send one (which gives "")
 */
export function sanitizeETag(etag = "") {
  return etag.replace(/^(?:"|&quot;|&#34;)|(?:"|&quot;|&#34;)$/g, "");
}

export function getVersionId(headers: Headers): string | null {
  return headers.get("x-amz-version-id") ?? null;
}

/** Create a Date string with format: 'YYYYMMDDTHHmmss' + Z */
export function makeDateLong(date: Date) {
  // toISOString() gives format like: '2017-08-07T16:28:59.889Z'
  return date.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

/** Create a Date string with format: 'YYYYMMDD' */
export function makeDateShort(date: Date) {
  return makeDateLong(date).slice(0, 8);
}

export function getScope(region: string, date: Date) {
  return `${makeDateShort(date)}/${region}/s3/aws4_request`;
}

export async function sha256digestHex(data: Uint8Array_ | string) {
  if (!(data instanceof Uint8Array)) {
    data = new TextEncoder().encode(data);
  }
  return bin2hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}
