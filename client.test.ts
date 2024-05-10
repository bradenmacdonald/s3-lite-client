import { assertEquals } from "@std/assert/assert-equals";
import { Client } from "./client.ts";

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
  },
});
