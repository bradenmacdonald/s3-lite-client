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
export function isValidObjectName(objectName: string) {
  if (!isValidPrefix(objectName)) return false;
  if (objectName.length === 0) return false;
  return true;
}

// check if prefix is valid
export function isValidPrefix(prefix: string) {
  if (typeof prefix !== "string") return false;
  if (prefix.length > 1024) return false;
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

export function sanitizeETag(etag = "") {
  const replaceChars: Record<string, string> = {
    '"': "",
    "&quot;": "",
    "&#34;": "",
    "&QUOT;": "",
    "&#x00022": "",
  };
  return etag.replace(
    /^("|&quot;|&#34;)|("|&quot;|&#34;)$/g,
    (m) => replaceChars[m],
  );
}

export function getVersionId(headers: Headers): string | null {
  return headers.get("x-amz-version-id") ?? null;
}

/** Create a Date string with format: 'YYYYMMDDTHHmmss' + Z */
export function makeDateLong(date: Date) {
  // Gives format like: '2017-08-07T16:28:59.889Z'
  const dateStr = date.toISOString();

  return dateStr.slice(0, 4) +
    dateStr.slice(5, 7) +
    dateStr.slice(8, 13) +
    dateStr.slice(14, 16) +
    dateStr.slice(17, 19) + "Z";
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
