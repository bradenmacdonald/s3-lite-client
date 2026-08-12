import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import type { Client } from "./client.ts";
import { ObjectUploader } from "./object-uploader.ts";

/**
 * A fake Client that pretends to be an S3 server, so we can test the multi-part upload logic
 * without a real server. It records how many part uploads were in flight at the same time.
 */
function makeFakeClient(partUploadDelayMs = 5) {
  const state = { inFlight: 0, maxInFlight: 0, partsUploaded: [] as number[] };
  const client = {
    // deno-lint-ignore no-explicit-any
    async makeRequest(options: any): Promise<Response> {
      if (options.query === undefined) {
        // A plain PUT: the whole object is being uploaded in a single request.
        return new Response(null, { headers: { etag: `"single-request-etag"` } });
      } else if (options.query === "uploads") {
        return new Response(
          `<InitiateMultipartUploadResult><UploadId>fake-upload-id</UploadId></InitiateMultipartUploadResult>`,
        );
      } else if (typeof options.query === "string" && options.query.startsWith("uploadId=")) {
        return new Response(
          `<CompleteMultipartUploadResult><ETag>&#34;fake-etag-20&#34;</ETag></CompleteMultipartUploadResult>`,
        );
      }
      // Otherwise, this is uploading one part of the multi-part upload:
      const partNumber = Number(options.query.partNumber);
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, partUploadDelayMs));
      state.inFlight--;
      state.partsUploaded.push(partNumber);
      return new Response(null, { headers: { etag: `"fake-etag-${partNumber}"` } });
    },
  };
  return { client: client as unknown as Client, state };
}

Deno.test({
  name: "ObjectUploader uploads parts in parallel, but only a limited number at a time",
  fn: async () => {
    const { client, state } = makeFakeClient();
    const partSize = 10;
    const uploader = new ObjectUploader({
      client,
      bucketName: "test-bucket",
      objectName: "test-key",
      partSize,
      metadata: {},
    });

    // Write 20 parts. Each chunk is exactly partSize, so none of them is the "small enough for a
    // single request" case, and we get a 20-part multi-part upload.
    const writer = uploader.getWriter();
    for (let i = 0; i < 20; i++) {
      await writer.write(new Uint8Array(partSize).fill(i));
    }
    await writer.close();

    assertEquals(state.partsUploaded.length, 20);
    assertEquals(uploader.getResult().etag, "fake-etag-20");
    // Parts are uploaded in parallel...
    assert(state.maxInFlight > 1, `expected parallel uploads, but only ${state.maxInFlight} was in flight at a time`);
    // ...but we never have more than a few in flight at once, since each one costs us partSize
    // bytes of memory until the server accepts it.
    assert(state.maxInFlight <= 4, `expected at most 4 parts in flight, but ${state.maxInFlight} were`);
  },
});

Deno.test({
  name: "ObjectUploader uses a single request when the data is smaller than the part size",
  fn: async () => {
    const { client, state } = makeFakeClient();
    const uploader = new ObjectUploader({
      client,
      bucketName: "test-bucket",
      objectName: "test-key",
      partSize: 1024,
      metadata: {},
    });
    const writer = uploader.getWriter();
    await writer.write(new Uint8Array(1000));
    await writer.close();

    // It never started a multi-part upload; the ETag comes from the single PUT request:
    assertEquals(state.partsUploaded, []);
    assertEquals(uploader.getResult().etag, "single-request-etag");
  },
});
