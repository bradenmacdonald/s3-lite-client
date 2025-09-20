import * as errors from "./errors.ts";
import { bin2hex, getScope, makeDateLong, makeDateShort, sha256digestHex, type Uint8Array_ } from "./helpers.ts";

const signV4Algorithm = "AWS4-HMAC-SHA256";

/**
 * Generate the Authorization header required to authenticate an S3/AWS request.
 */
export async function signV4(request: {
  headers: Headers;
  method: string;
  path: string;
  accessKey: string;
  secretKey: string;
  region: string;
  date: Date;
}): Promise<string> {
  if (!request.accessKey) {
    throw new errors.AccessKeyRequiredError("accessKey is required for signing");
  }
  if (!request.secretKey) {
    throw new errors.SecretKeyRequiredError("secretKey is required for signing");
  }

  const sha256sum = request.headers.get("x-amz-content-sha256");
  if (sha256sum === null) {
    throw new Error(
      "Internal S3 client error - expected x-amz-content-sha256 header, but it's missing.",
    );
  }

  const signedHeaders = getHeadersToSign(request.headers);
  const canonicalRequest = getCanonicalRequest(
    request.method,
    request.path,
    request.headers,
    signedHeaders,
    sha256sum,
  );
  const stringToSign = await getStringToSign(
    canonicalRequest,
    request.date,
    request.region,
  );
  const signingKey = await getSigningKey(
    request.date,
    request.region,
    request.secretKey,
  );
  const credential = getCredential(
    request.accessKey,
    request.region,
    request.date,
  );
  const signature = bin2hex(await sha256hmac(signingKey, stringToSign))
    .toLowerCase();

  return `${signV4Algorithm} Credential=${credential}, SignedHeaders=${
    signedHeaders.join(";").toLowerCase()
  }, Signature=${signature}`;
}

/**
 * Generate a pre-signed URL
 */
export async function presignV4(request: {
  protocol: "http:" | "https:";
  headers: Headers;
  method: string;
  path: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
  region: string;
  date: Date;
  expirySeconds: number;
}): Promise<string> {
  if (!request.accessKey) {
    throw new errors.AccessKeyRequiredError("accessKey is required for signing");
  }
  if (!request.secretKey) {
    throw new errors.SecretKeyRequiredError("secretKey is required for signing");
  }
  if (request.expirySeconds < 1) {
    throw new errors.InvalidExpiryError("expirySeconds cannot be less than 1 seconds");
  }
  if (request.expirySeconds > 604800) {
    throw new errors.InvalidExpiryError("expirySeconds cannot be greater than 7 days");
  }
  if (!request.headers.has("Host")) {
    throw new Error("Internal error: host header missing");
  }

  // Information about the future request that we're going to sign:
  const resource = request.path.split("?")[0];
  const queryString = request.path.split("?")[1];
  const iso8601Date = makeDateLong(request.date);
  const signedHeaders = getHeadersToSign(request.headers);
  const credential = getCredential(request.accessKey, request.region, request.date);
  const hashedPayload = "UNSIGNED-PAYLOAD";

  // Build the query string for our new signed URL:
  const newQuery = new URLSearchParams(queryString);
  newQuery.set("X-Amz-Algorithm", signV4Algorithm);
  newQuery.set("X-Amz-Credential", credential);
  newQuery.set("X-Amz-Date", iso8601Date);
  newQuery.set("X-Amz-Expires", request.expirySeconds.toString());
  newQuery.set("X-Amz-SignedHeaders", signedHeaders.join(";").toLowerCase());
  if (request.sessionToken) {
    newQuery.set("X-Amz-Security-Token", request.sessionToken);
  }
  const newQueryString = newQuery.toString().replace("+", "%20"); // Signing requires spaces become %20, never +
  const signingPath = resource + "?" + newQueryString;
  const encodedPath = resource.split("/").map((part) => encodeURIComponent(part)).join("/");

  const canonicalRequest = getCanonicalRequest(
    request.method,
    signingPath,
    request.headers,
    signedHeaders,
    hashedPayload,
  );
  const stringToSign = await getStringToSign(canonicalRequest, request.date, request.region);
  const signingKey = await getSigningKey(request.date, request.region, request.secretKey);
  const signature = bin2hex(await sha256hmac(signingKey, stringToSign)).toLowerCase();
  // deno-fmt-ignore
  const presignedUrl = `${request.protocol}//${request.headers.get("Host")}${encodedPath}?${newQueryString}&X-Amz-Signature=${signature}`;
  return presignedUrl;
}

/**
 * Given the set of HTTP headers that we'll be sending with an S3/AWS request, determine which
 * headers will be signed, and in what order.
 */
function getHeadersToSign(headers: Headers): string[] {
  // Excerpts from @lsegal - https://github.com/aws/aws-sdk-js/issues/659#issuecomment-120477258
  //
  //  User-Agent:
  //
  //      This is ignored from signing because signing this causes problems with generating pre-signed URLs
  //      (that are executed by other agents) or when customers pass requests through proxies, which may
  //      modify the user-agent.
  //
  //  Content-Length:
  //
  //      This is ignored from signing because generating a pre-signed URL should not provide a content-length
  //      constraint, specifically when vending a S3 pre-signed PUT URL. The corollary to this is that when
  //      sending regular requests (non-pre-signed), the signature contains a checksum of the body, which
  //      implicitly validates the payload length (since changing the number of bytes would change the checksum)
  //      and therefore this header is not valuable in the signature.
  //
  //  Content-Type:
  //
  //      Signing this header causes quite a number of problems in browser environments, where browsers
  //      like to modify and normalize the content-type header in different ways. There is more information
  //      on this in https://github.com/aws/aws-sdk-js/issues/244. Avoiding this field simplifies logic
  //      and reduces the possibility of future bugs
  //
  //  Authorization:
  //
  //      Is skipped for obvious reasons

  const ignoredHeaders = [
    "authorization",
    "content-length",
    "content-type",
    "user-agent",
  ];
  const headersToSign = [];
  for (const key of headers.keys()) {
    if (ignoredHeaders.includes(key.toLowerCase())) {
      continue; // Ignore this header
    }
    headersToSign.push(key);
  }
  headersToSign.sort();
  return headersToSign;
}

const CODES = {
  A: "A".charCodeAt(0),
  Z: "Z".charCodeAt(0),
  a: "a".charCodeAt(0),
  z: "z".charCodeAt(0),
  "0": "0".charCodeAt(0),
  "9": "9".charCodeAt(0),
  "/": "/".charCodeAt(0),
};
const ALLOWED_BYTES = "-._~".split("").map((s) => s.charCodeAt(0));

/**
 * Canonical URI encoding for signing, per AWS documentation:
 * 1. URI encode every byte except the unreserved characters:
 *    'A'-'Z', 'a'-'z', '0'-'9', '-', '.', '_', and '~'.
 * 2. The space character must be encoded as "%20" (and not as "+").
 * 3. Each URI encoded byte is formed by a '%' and the
 *    two-digit uppercase hexadecimal value of the byte. e.g. "%1A".
 * 4. Encode the forward slash character, '/', everywhere except
 *    in the object key name. For example, if the object key name
 *    is photos/Jan/sample.jpg, the forward slash in the key name
 *    is not encoded.
 *
 * See https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 *
 * @param string the string to encode.
 */
function awsUriEncode(string: string, allowSlashes = false) {
  const bytes: Uint8Array = new TextEncoder().encode(string);
  let encoded = "";
  for (const byte of bytes) {
    if (
      (byte >= CODES.A && byte <= CODES.Z) ||
      (byte >= CODES.a && byte <= CODES.z) ||
      (byte >= CODES["0"] && byte <= CODES["9"]) ||
      (ALLOWED_BYTES.includes(byte)) ||
      (byte == CODES["/"] && allowSlashes)
    ) {
      encoded += String.fromCharCode(byte);
    } else {
      encoded += "%" + byte.toString(16).padStart(2, "0").toUpperCase();
    }
  }
  return encoded;
}

/**
 * getCanonicalRequest generate a canonical request of style.
 *
 * canonicalRequest =
 *   <HTTPMethod>\n
 *   <CanonicalURI>\n
 *   <CanonicalQueryString>\n
 *   <CanonicalHeaders>\n
 *   <SignedHeaders>\n
 *   <HashedPayload>
 */
function getCanonicalRequest(
  method: string,
  path: string,
  headers: Headers,
  headersToSign: string[],
  payloadHash: string,
): string {
  const headersArray = headersToSign.reduce<string[]>((acc, headerKey) => {
    // Trim spaces from the value (required by V4 spec)
    const val = `${headers.get(headerKey)}`.replace(/ +/g, " ");
    acc.push(`${headerKey.toLowerCase()}:${val}`);
    return acc;
  }, []);

  const requestResource = path.split("?")[0];
  let requestQuery = path.split("?")[1];
  if (requestQuery) {
    requestQuery = requestQuery
      .split("&")
      .map((element) => {
        const [key, val] = element.split("=", 2);
        // The input is assumed to be encoded, so we need to decode it first.
        return awsUriEncode(decodeURIComponent(key)) + "=" + awsUriEncode(decodeURIComponent(val || ""));
      })
      .sort() // sort after encoding
      .join("&");
  } else {
    requestQuery = "";
  }

  const canonical = [];
  canonical.push(method.toUpperCase());
  canonical.push(awsUriEncode(requestResource, true));
  canonical.push(requestQuery);
  canonical.push(headersArray.join("\n") + "\n");
  canonical.push(headersToSign.join(";").toLowerCase());
  canonical.push(payloadHash);
  return canonical.join("\n");
}

// returns the string that needs to be signed
async function getStringToSign(
  canonicalRequest: string,
  requestDate: Date,
  region: string,
): Promise<string> {
  const hash = await sha256digestHex(canonicalRequest);
  const scope = getScope(region, requestDate);
  const stringToSign = [];
  stringToSign.push(signV4Algorithm);
  stringToSign.push(makeDateLong(requestDate));
  stringToSign.push(scope);
  stringToSign.push(hash);
  return stringToSign.join("\n");
}

/** returns the key used for calculating signature */
async function getSigningKey(
  date: Date,
  region: string,
  secretKey: string,
): Promise<Uint8Array_> {
  const dateLine = makeDateShort(date);
  const hmac1 = await sha256hmac("AWS4" + secretKey, dateLine);
  const hmac2 = await sha256hmac(hmac1, region);
  const hmac3 = await sha256hmac(hmac2, "s3");
  return await sha256hmac(hmac3, "aws4_request");
}

/** generate a credential string  */
function getCredential(accessKey: string, region: string, requestDate: Date) {
  return `${accessKey}/${getScope(region, requestDate)}`;
}

/**
 * Given a secret key and some data, generate a HMAC of the data using SHA-256.
 * @param secretKey
 * @param data
 * @returns
 */
async function sha256hmac(
  secretKey: Uint8Array_ | string,
  data: Uint8Array_ | string,
): Promise<Uint8Array_> {
  const enc = new TextEncoder();
  const keyObject = await crypto.subtle.importKey(
    "raw", // raw format of the key - should be Uint8Array
    secretKey instanceof Uint8Array ? secretKey : enc.encode(secretKey),
    { name: "HMAC", hash: { name: "SHA-256" } }, // algorithm
    false, // export = false
    ["sign", "verify"], // what this key can do
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    keyObject,
    data instanceof Uint8Array ? data : enc.encode(data),
  );
  return new Uint8Array(signature);
}

/**
 * Type for S3 Post Policy conditions
 * S3 allows conditions to have different shapes
 */
type PolicyCondition = Record<string, unknown> | string[];

/**
 * Generate a presigned POST policy that can be used to allow direct uploads to S3.
 * This is equivalent to AWS SDK's presignedPost functionality.
 */
export async function presignPostV4(request: {
  host: string;
  protocol: "http:" | "https:";
  bucket: string;
  objectKey: string;
  accessKey: string;
  secretKey: string;
  region: string;
  date: Date;
  expirySeconds: number;
  conditions?: PolicyCondition[];
  fields?: Record<string, string>;
}): Promise<{
  url: string;
  fields: Record<string, string>;
}> {
  if (!request.accessKey) {
    throw new errors.AccessKeyRequiredError("accessKey is required for signing");
  }
  if (!request.secretKey) {
    throw new errors.SecretKeyRequiredError("secretKey is required for signing");
  }
  if (request.expirySeconds < 1) {
    throw new errors.InvalidExpiryError("expirySeconds cannot be less than 1 seconds");
  }
  if (request.expirySeconds > 604800) {
    throw new errors.InvalidExpiryError("expirySeconds cannot be greater than 7 days");
  }

  const expiration = new Date(request.date);
  expiration.setSeconds(expiration.getSeconds() + request.expirySeconds);
  const iso8601ExpirationDate = expiration.toISOString();
  const credential = getCredential(request.accessKey, request.region, request.date);
  const iso8601Date = makeDateLong(request.date);

  // Default required policy fields
  const fields: Record<string, string> = {
    "X-Amz-Algorithm": signV4Algorithm,
    "X-Amz-Credential": credential,
    "X-Amz-Date": iso8601Date,
    "key": request.objectKey,
    ...request.fields,
  };

  // Build policy document
  const conditions: PolicyCondition[] = [
    { bucket: request.bucket },
    { key: request.objectKey },
    { "X-Amz-Algorithm": signV4Algorithm },
    { "X-Amz-Credential": credential },
    { "X-Amz-Date": iso8601Date },
  ];

  // Add any additional conditions provided by the user
  if (request.conditions) {
    conditions.push(...request.conditions);
  }

  // Add additional fields as conditions
  for (const [key, value] of Object.entries(request.fields || {})) {
    // Skip fields that we've already added to conditions
    if (["key", "X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date"].includes(key)) continue;
    conditions.push({ [key]: value });
  }

  const policy = {
    expiration: iso8601ExpirationDate,
    conditions,
  };

  // Convert policy to base64
  const encoder = new TextEncoder();
  const policyBytes = encoder.encode(JSON.stringify(policy));
  const base64Policy = btoa(String.fromCharCode(...policyBytes));
  fields["policy"] = base64Policy;

  // Calculate signature
  const stringToSign = base64Policy;
  const dateKey = await sha256hmac(
    "AWS4" + request.secretKey,
    makeDateShort(request.date),
  );
  const dateRegionKey = await sha256hmac(dateKey, request.region);
  const dateRegionServiceKey = await sha256hmac(dateRegionKey, "s3");
  const signingKey = await sha256hmac(dateRegionServiceKey, "aws4_request");
  const signature = bin2hex(await sha256hmac(signingKey, stringToSign)).toLowerCase();
  fields["X-Amz-Signature"] = signature;

  // Construct the URL
  const url = `${request.protocol}//${request.host}/${request.bucket}`;

  return { url, fields };
}

// Export for testing purposes only
export const _internalMethods = {
  awsUriEncode,
  getHeadersToSign,
  getCanonicalRequest,
  getStringToSign,
  getSigningKey,
  getCredential,
  sha256hmac,
};
