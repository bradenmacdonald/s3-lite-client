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
  },
});
