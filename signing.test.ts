import { assertEquals } from "./deps-tests.ts";
import { bin2hex } from "./helpers.ts";
import { _internalMethods as methods, signV4 } from "./signing.ts";

const {
  getHeadersToSign,
  getCanonicalRequest,
  getStringToSign,
  getSigningKey,
  getCredential,
  sha256hmac,
} = methods;

Deno.test({
  name: "signV4 - test 1",
  fn: async () => {
    const authHeaderActual = await signV4({
      method: "POST",
      path: "/bucket/object",
      headers: new Headers({
        host: "localhost:9000",
        "x-amz-content-sha256": "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
      }),
      accessKey: "AKIA_TEST_ACCESS_KEY",
      secretKey: "ThisIsTheSecret",
      region: "ca-central-1",
      date: new Date("2021-10-26T18:07:28.492Z"),
    });
    assertEquals(
      authHeaderActual,
      "AWS4-HMAC-SHA256 Credential=AKIA_TEST_ACCESS_KEY/20211026/ca-central-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256, Signature=29a1fe12b9d7ae705af5e01614deaacaf435fe2081949e05b02d4fd7b4bc82a9",
    );
  },
});

Deno.test({
  name: "signV4 - test 2",
  fn: async () => {
    const authHeaderActual = await signV4({
      method: "GET",
      path: "/object/key/here?query1=test&query2=234567",
      headers: new Headers({
        "Host": "s3.amazonaws.com",
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=604800, immutable",
        "Content-Disposition": `attachment; filename="image.svg"`,
        "x-amz-storage-class": "GLACIER",
        "x-amz-content-sha256": "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
      }),
      accessKey: "accesskey123",
      secretKey: "#$*&!#@%&(#@$(*",
      region: "test-region",
      date: new Date("2020-05-13T12:09:14.377Z"),
    });
    assertEquals(
      authHeaderActual,
      "AWS4-HMAC-SHA256 Credential=accesskey123/20200513/test-region/s3/aws4_request, SignedHeaders=cache-control;content-disposition;host;x-amz-content-sha256;x-amz-storage-class, Signature=0fcf3962ff9c6ddcfd31d7cdfb42cd70e187790a16fba5402854417a1ac83ba5",
    );
  },
});

Deno.test({
  name: "getHeadersToSign",
  fn: () => {
    assertEquals(
      getHeadersToSign(
        new Headers({
          "Host": "s3.amazonaws.com",
          "Content-Length": "89327523384",
          "User-Agent": "Deno S3 Lite Client",
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=604800, immutable",
          "Content-Disposition": `attachment; filename="image.svg"`,
          "x-amz-storage-class": "GLACIER",
        }),
      ),
      [
        "cache-control",
        "content-disposition",
        "host",
        "x-amz-storage-class",
      ],
    );
  },
});

Deno.test({
  name: "getCanonicalRequest",
  fn: () => {
    assertEquals(
      getCanonicalRequest(
        "POST",
        "/bucket/object123",
        new Headers({ "Sign-me": "yes", "Dont-Sign-me": "no" }),
        ["sign-me"],
        "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
      ),
      "POST\n" +
        "/bucket/object123\n" +
        "\n" + // no query string
        "sign-me:yes\n" + // first header key + value
        "\n" + // end of headers
        "sign-me\n" + // list of signed headers
        "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7", // hash of the payload
    );
    assertEquals(
      getCanonicalRequest(
        "GET",
        "/object123?query1=present",
        new Headers({
          "other-header": "value2",
          "third-header": "3",
          "host": "mybucket.mycompany.com",
        }),
        ["host", "other-header", "third-header"],
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ),
      "GET\n" +
        "/object123\n" +
        "query1=present\n" +
        "host:mybucket.mycompany.com\n" +
        "other-header:value2\n" +
        "third-header:3\n" +
        "\n" +
        "host;other-header;third-header\n" +
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  },
});

Deno.test({
  name: "getStringToSign",
  fn: async () => {
    assertEquals(
      await getStringToSign(
        "canonical\nrequest\nhere",
        new Date("2021-10-26T18:07:28.492Z"),
        "us-gov-east-1",
      ),
      "AWS4-HMAC-SHA256\n" +
        "20211026T180728Z\n" +
        "20211026/us-gov-east-1/s3/aws4_request\n" +
        "473235b6e64747e5ee3adb25c3422d7f98d2d62c025011dfe8d94f6d7104a9fc",
    );
    assertEquals(
      await getStringToSign(
        "some\nother\nREQUEST\nhere!@#!$",
        new Date("2017-08-11T17:26:34.935Z"),
        "ca-central-1",
      ),
      "AWS4-HMAC-SHA256\n" +
        "20170811T172634Z\n" +
        "20170811/ca-central-1/s3/aws4_request\n" +
        "7d9363dc00f13c30e5621589e1d842ad9d0a7170daa0830d221628e95100a6d4",
    );
  },
});

Deno.test({
  name: "getStringToSign",
  fn: async () => {
    assertEquals(
      await getStringToSign(
        "canonical\nrequest\nhere",
        new Date("2021-10-26T18:07:28.492Z"),
        "us-gov-east-1",
      ),
      "AWS4-HMAC-SHA256\n" +
        "20211026T180728Z\n" +
        "20211026/us-gov-east-1/s3/aws4_request\n" +
        "473235b6e64747e5ee3adb25c3422d7f98d2d62c025011dfe8d94f6d7104a9fc",
    );
    assertEquals(
      await getStringToSign(
        "some\nother\nREQUEST\nhere!@#!$",
        new Date("2017-08-11T17:26:34.935Z"),
        "ca-central-1",
      ),
      "AWS4-HMAC-SHA256\n" +
        "20170811T172634Z\n" +
        "20170811/ca-central-1/s3/aws4_request\n" +
        "7d9363dc00f13c30e5621589e1d842ad9d0a7170daa0830d221628e95100a6d4",
    );
  },
});

Deno.test({
  name: "getSigningKey",
  fn: async () => {
    assertEquals(
      bin2hex(
        await getSigningKey(
          new Date("2017-08-11T17:26:34.935Z"),
          "eu-west-3",
          "SECRETd17n298wnqe",
        ),
      ),
      "f1ba68876e273e5b3dd2477639df79587d894fa12eae1eb0df1d17852874abf3",
    );
    assertEquals(
      bin2hex(
        await getSigningKey(
          new Date("2021-10-26T18:07:28.492Z"),
          "ca-central-1",
          "ThisIsTheSecret",
        ),
      ),
      "76174baea77bcc266f63ed893b2bb07c1ebc59a02f55303f85d99fc68f568094",
    );
  },
});

Deno.test({
  name: "getCredential",
  fn: () => {
    assertEquals(
      getCredential(
        "AKIA_ACCESS_KEY",
        "us-west-2",
        new Date("2017-08-11T17:26:34.935Z"),
      ),
      "AKIA_ACCESS_KEY/20170811/us-west-2/s3/aws4_request",
    );
    assertEquals(
      getCredential(
        "otherAccessKey",
        "eu-west-3",
        new Date("2021-10-26T18:07:28.492Z"),
      ),
      "otherAccessKey/20211026/eu-west-3/s3/aws4_request",
    );
  },
});

Deno.test({
  name: "sha256hmac",
  fn: async () => {
    assertEquals(
      bin2hex(await sha256hmac("secret", "this is the data")),
      "d856191c41ef073996cd1dc468b8e8534fae720a52cf06d47ba4466a21995d28",
    );
    assertEquals(
      bin2hex(await sha256hmac("secret", new Uint8Array([]))),
      "f9e66e179b6747ae54108f82f8ade8b3c25d76fd30afde6c395822c530196169",
    );
    assertEquals(
      // An empty string is treated the same as an empty array
      await sha256hmac("secret", new Uint8Array([])),
      await sha256hmac("secret", ""),
    );
    assertEquals(
      bin2hex(await sha256hmac("other secret", "other data")),
      "dc4833db4b1094fa86bb622dab5ca2ab4026065db473ffad5700adac105bca9d",
    );
  },
});
