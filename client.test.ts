import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import { assertThrows } from "@std/assert/throws";
import { Client } from "./client.ts";
import { S3Errors } from "./mod.ts";

Deno.test({
  name: "host/port numbers",
  fn: async (t) => {
    const endPoint = "s3.eu-north-1.amazonaws.com";
    const region = "eu-north-1";

    await t.step("default insecure", () => {
      const client = new Client({ endPoint, region });
      // We default to HTTPS:
      assertEquals(client.port, 443);
      assertEquals(client.protocol, "https:");
      assertEquals(client.host, endPoint); // Default port 443 should not be in host
    });

    await t.step("default explicit secure", () => {
      const client = new Client({ endPoint, region, useSSL: true });
      assertEquals(client.port, 443);
      assertEquals(client.protocol, "https:");
      assertEquals(client.host, endPoint);
    });

    await t.step("default explicit secure, explicit default port", () => {
      const client = new Client({ endPoint, region, useSSL: true, port: 443 });
      assertEquals(client.port, 443);
      assertEquals(client.protocol, "https:");
      assertEquals(client.host, endPoint);
    });

    await t.step("default explicit secure, explicit non-default port", () => {
      const client = new Client({ endPoint, region, useSSL: true, port: 5432 });
      assertEquals(client.port, 5432);
      assertEquals(client.protocol, "https:");
      assertEquals(client.host, endPoint + ":5432"); // Now port must be in the host
    });

    await t.step("default explicit INsecure", () => {
      const client = new Client({ endPoint, region, useSSL: false });
      assertEquals(client.port, 80);
      assertEquals(client.protocol, "http:");
      assertEquals(client.host, endPoint);
    });

    await t.step("default explicit INsecure, explicit default port", () => {
      const client = new Client({ endPoint, region, useSSL: false, port: 80 });
      assertEquals(client.port, 80);
      assertEquals(client.protocol, "http:");
      assertEquals(client.host, endPoint); // Port should not be in the host
    });

    await t.step("default explicit INsecure, explicit non-default port", () => {
      const client = new Client({ endPoint, region, useSSL: false, port: 5432 });
      assertEquals(client.port, 5432);
      assertEquals(client.protocol, "http:");
      assertEquals(client.host, endPoint + ":5432"); // Port is required
    });

    await t.step("supabase development example", () => {
      const client = new Client({
        endPoint: "127.0.0.1",
        port: 54321,
        useSSL: false,
        region: "local",
        pathPrefix: "/storage/v1/s3",
        accessKey: "123456a08b95bf1b7ff3510000000000",
        secretKey: "123456e4652dd023b7abcdef0e0d2d34bd487ee0cc3254aed6eda30000000000",
      });
      assertEquals(client.port, 54321);
      assertEquals(client.protocol, "http:");
      assertEquals(client.host, "127.0.0.1:54321");
      assertEquals(client.pathPrefix, "/storage/v1/s3");
    });

    // New tests for URL parsing
    await t.step("full HTTPS URL", () => {
      const client = new Client({
        endPoint: "https://s3.eu-north-1.amazonaws.com",
        region: "eu-north-1",
      });
      assertEquals(client.port, 443);
      assertEquals(client.protocol, "https:");
      assertEquals(client.host, "s3.eu-north-1.amazonaws.com");
      assertEquals(client.pathPrefix, "");
    });

    await t.step("full HTTP URL", () => {
      const client = new Client({
        endPoint: "http://s3.eu-north-1.amazonaws.com",
        region: "eu-north-1",
      });
      assertEquals(client.port, 80);
      assertEquals(client.protocol, "http:");
      assertEquals(client.host, "s3.eu-north-1.amazonaws.com");
      assertEquals(client.pathPrefix, "");
    });

    await t.step("URL with port", () => {
      const client = new Client({
        endPoint: "https://s3.eu-north-1.amazonaws.com:8443",
        region: "eu-north-1",
      });
      assertEquals(client.port, 8443);
      assertEquals(client.protocol, "https:");
      assertEquals(client.host, "s3.eu-north-1.amazonaws.com:8443");
      assertEquals(client.pathPrefix, "");
    });

    await t.step("URL with path prefix", () => {
      const client = new Client({
        endPoint: "https://example.com/storage/v1/s3",
        region: "us-east-1",
      });
      assertEquals(client.port, 443);
      assertEquals(client.protocol, "https:");
      assertEquals(client.host, "example.com");
      assertEquals(client.pathPrefix, "/storage/v1/s3");
    });

    await t.step("URL with path prefix (trailing slash)", () => {
      const client = new Client({
        endPoint: "https://example.com/storage/v1/s3/",
        region: "us-east-1",
      });
      assertEquals(client.port, 443);
      assertEquals(client.protocol, "https:");
      assertEquals(client.host, "example.com");
      assertEquals(client.pathPrefix, "/storage/v1/s3");
    });

    await t.step("URL with all components", () => {
      const client = new Client({
        endPoint: "http://localhost:9000/my-prefix",
        region: "local",
      });
      assertEquals(client.port, 9000);
      assertEquals(client.protocol, "http:");
      assertEquals(client.host, "localhost:9000");
      assertEquals(client.pathPrefix, "/my-prefix");
    });

    await t.step("useSSL conflicts with URL protocol", () => {
      assertThrows(
        () => {
          new Client({
            endPoint: "http://s3.example.com",
            region: "us-east-1",
            useSSL: true, // This conflicts with the http:// in the URL
          });
        },
        S3Errors.InvalidArgumentError,
        "useSSL/port/pathPrefix cannot be specified if endPoint is a URL.",
      );
    });

    await t.step("explicit port conflicts with URL port", () => {
      assertThrows(
        () => {
          new Client({
            endPoint: "https://s3.example.com:8443",
            region: "us-east-1",
            port: 9000, // This conflicts with the port in the URL
          });
        },
        S3Errors.InvalidArgumentError,
        "useSSL/port/pathPrefix cannot be specified if endPoint is a URL.",
      );
    });

    await t.step("explicit pathPrefix conflicts with URL path", () => {
      assertThrows(
        () => {
          new Client({
            endPoint: "https://example.com/from-url",
            region: "us-east-1",
            pathPrefix: "/from-param", // This conflicts with the path in the URL
          });
        },
        S3Errors.InvalidArgumentError,
        "useSSL/port/pathPrefix cannot be specified if endPoint is a URL.",
      );
    });

    // Test for object name URL encoding
    await t.step("object name with plus sign requires encoding", async () => {
      const client = new Client({
        endPoint: "s3.amazonaws.com",
        region: "us-east-1",
        bucket: "test-bucket",
        accessKey: "test-access-key",
        secretKey: "test-secret-key",
      });

      const objectName = "apps/test.app.com/3.0.125+b[TEST,75].f5d735b49.zip";
      const presignedUrl = await client.getPresignedUrl("GET", objectName);

      // The URL should contain %2B instead of + for proper URL encoding
      assertEquals(presignedUrl.includes("+"), false, "Presigned URL should not contain unencoded '+' character");
      assertEquals(presignedUrl.includes("%2B"), true, "Presigned URL should contain URL-encoded '+' as '%2B'");
      assertEquals(
        presignedUrl.includes("/test-bucket/apps/test.app.com/3.0.125%2Bb%5BTEST%2C75%5D.f5d735b49.zip"),
        true,
        "URL should contain properly encoded object path",
      );
    });
  },
});

Deno.test({
  name: "object operations encode '+' in object names",
  fn: async (t) => {
    const client = new Client({
      endPoint: "s3.amazonaws.com",
      region: "us-east-1",
      bucket: "test-bucket",
      accessKey: "test-access-key",
      secretKey: "test-secret-key",
    });

    const objectName = "folder/with+sign.txt";

    await t.step("deleteObject encodes path", async () => {
      const originalFetch = globalThis.fetch;
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = ((input: RequestInfo, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        calls.push({ url, init });
        return Promise.resolve(new Response(null, { status: 204 }));
      }) as typeof globalThis.fetch;

      try {
        await client.deleteObject(objectName);
      } finally {
        globalThis.fetch = originalFetch;
      }

      assertEquals(calls.length, 1);
      const { url, init } = calls[0];
      assert(url.startsWith("https://s3.amazonaws.com/test-bucket/"));
      assert(!url.includes("+"));
      assert(url.includes("with%2Bsign.txt"));
      assertEquals(init?.method, "DELETE");
    });

    await t.step("exists encodes path for HEAD", async () => {
      const originalFetch = globalThis.fetch;
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = ((input: RequestInfo, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        calls.push({ url, init });
        return Promise.resolve(
          new Response(null, {
            status: 200,
            headers: {
              "content-length": "0",
              "Last-Modified": new Date("2024-01-01T00:00:00Z").toUTCString(),
              "ETag": "\"etag\"",
            },
          }),
        );
      }) as typeof globalThis.fetch;

      let exists: boolean;
      try {
        exists = await client.exists(objectName);
      } finally {
        globalThis.fetch = originalFetch;
      }

      assertEquals(exists, true);
      assertEquals(calls.length, 1);
      const { url, init } = calls[0];
      assert(url.startsWith("https://s3.amazonaws.com/test-bucket/"));
      assert(!url.includes("+"));
      assert(url.includes("with%2Bsign.txt"));
      assertEquals(init?.method, "HEAD");
    });

    await t.step("getObject encodes path for GET", async () => {
      const originalFetch = globalThis.fetch;
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      globalThis.fetch = ((input: RequestInfo, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        calls.push({ url, init });
        return Promise.resolve(new Response("payload", { status: 200, headers: { "content-length": "7" } }));
      }) as typeof globalThis.fetch;

      let response: Response;
      try {
        response = await client.getObject(objectName);
      } finally {
        globalThis.fetch = originalFetch;
      }

      assertEquals(await response.text(), "payload");
      assertEquals(calls.length, 1);
      const { url, init } = calls[0];
      assert(url.startsWith("https://s3.amazonaws.com/test-bucket/"));
      assert(!url.includes("+"));
      assert(url.includes("with%2Bsign.txt"));
      assertEquals(init?.method, "GET");
    });
  },
});
