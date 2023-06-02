/**
 * These integration tests depend on a running MinIO installation.
 *
 * See the README for instructions.
 */
import { readableStreamFromIterable } from "./deps.ts";
import { assert, assertEquals, assertInstanceOf, assertRejects } from "./deps-tests.ts";
import { S3Client, S3Errors } from "./mod.ts";

const config = {
  endPoint: "localhost",
  port: 9000,
  useSSL: false,
  region: "dev-region",
  accessKey: "AKIA_DEV",
  secretKey: "secretkey",
  bucket: "dev-bucket",
  pathStyle: true,
};
const client = new S3Client(config);

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Test an unauthenticated client downloading public data

Deno.test({
  name: "the API client can be used without authentication (this also tests SSL and pathStyle: false)",
  fn: async () => {
    const publicClient = new S3Client({
      endPoint: "s3.amazonaws.com",
      port: 443,
      useSSL: true,
      region: "us-east-1",
      bucket: "amazon-pqa",
      pathStyle: false,
    });
    const response = await publicClient.getObject("readme.txt").then((r) => r.text());
    const expected = await fetch("https://amazon-pqa.s3.amazonaws.com/readme.txt").then((r) => r.text());
    assertEquals(response, expected);
  },
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Error parsing

Deno.test({
  name: "error parsing",
  fn: async () => {
    const unauthorizedClient = new S3Client({ ...config, secretKey: "invalid key" });
    const err = await assertRejects(
      () => unauthorizedClient.putObject("test.txt", "This is the contents of the file."),
    );
    assertInstanceOf(err, S3Errors.ServerError);
    assertEquals(err.statusCode, 403);
    assertEquals(err.code, "SignatureDoesNotMatch");
    assertEquals(
      err.message,
      "The request signature we calculated does not match the signature you provided. Check your key and signing method.",
    );
    assertEquals(err.bucketName, config.bucket);
    assertEquals(err.region, config.region);
  },
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// putObject()

Deno.test({
  name: "putObject() can upload a small file",
  fn: async () => {
    const response = await client.putObject("test.txt", "This is the contents of the file.");
    assertEquals(response.etag, "f6b64dbfb5d44e98363ff586e08f7fe6"); // The etag is generated by the server, based on the contents, so this confirms it worked.
  },
});

Deno.test({
  name: "putObject() can set metadata",
  fn: async () => {
    const key = "test-with-metadata.txt";
    await client.putObject(key, "This is the contents of the file.", {
      metadata: {
        "Content-Type": "text/plain",
        "Cache-Control": "public, max-age=456789, immutable",
        "x-amz-meta-custom-header": "This is a custom value",
      },
    });
    const stat = await client.statObject(key);
    assertEquals(stat.key, key);
    assertEquals(stat.metadata, {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=456789, immutable",
      "x-amz-meta-custom-header": "This is a custom value",
    });
  },
});

Deno.test({
  name: "putObject() can stream a large file upload",
  fn: async () => {
    // First generate a 32MiB file in memory, 1 MiB at a time, as a stream
    const dataStream = readableStreamFromIterable(async function* () {
      for (let i = 0; i < 32; i++) {
        yield new Uint8Array(1024 * 1024).fill(i % 256); // Yield 1MB of data
      }
    }());

    // Upload the 32MB stream data as 7 5MB parts. The client doesn't know in advance how big the stream is.
    const key = "test-32m.dat";
    const metadata = { "Content-Type": "test/streaming", "x-amz-meta-custom-header": "This is a custom value!" };
    const response = await client.putObject(key, dataStream, { partSize: 5 * 1024 * 1024, metadata });
    // The etag is generated by the server, based on the contents. Also, etags for multi-part uploads are
    // different than for regular uploads, so the "-7" confirms it worked and used a multi-part upload.
    assertEquals(response.etag, "ca6d977b6e7dc87ab5c5892e124c7277-7");
    // Validate that the metadata was set:
    const stat = await client.statObject(key);
    assertEquals(stat.metadata, metadata);
  },
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// exists()

Deno.test({
  name: "exists() can check if an object exists",
  fn: async () => {
    const result1 = await client.exists("definitely-does-not-exist.foobar");
    assertEquals(result1, false);
    await client.putObject("this-will-exist.now", "contents");
    const result2 = await client.exists("this-will-exist.now");
    assertEquals(result2, true);
  },
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// deleteObject()

Deno.test({
  name: "deleteObject() can delete an object",
  fn: async () => {
    const key = "object-for-deletion-tests.txt";
    await client.putObject(key, "contents");
    assertEquals(await client.exists(key), true);
    await client.deleteObject(key);
    assertEquals(await client.exists(key), false);
  },
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// statObject()

Deno.test({
  name: "statObject() can get an object's status",
  fn: async () => {
    const key = "test-stat.txt";
    const metadata = {
      "Content-Type": "test/fake-data",
      "Cache-Control": "public, max-age=456789, immutable",
      "x-amz-meta-custom-header": "This is a custom value!",
    };
    const contents = "This is the contents of the file. 🎈"; // Red balloon tests unicode support
    await client.putObject(key, contents, { metadata });
    const stat = await client.statObject(key);
    assertEquals(stat.type, "Object");
    assertEquals(stat.key, key);
    assertInstanceOf(stat.lastModified, Date);
    assertEquals(stat.lastModified.getFullYear(), new Date().getFullYear()); // This may fail at exactly midnight on New Year's, no big deal
    assertEquals(stat.size, new TextEncoder().encode(contents).length); // Size in bytes is different from the length of the string
    assertEquals(stat.versionId, null);
    assertEquals(stat.metadata, metadata);
  },
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// getObject()

Deno.test({
  name: "getObject() can download a small file",
  fn: async () => {
    const contents = "This is the contents of the file. 👻"; // Throw in an Emoji to ensure Unicode round-trip is working.
    await client.putObject("test-get.txt", contents);
    const response = await client.getObject("test-get.txt");
    assertEquals(await response.text(), contents);
  },
});

Deno.test({
  name: "getPartialObject() can download a partial file",
  fn: async () => {
    await client.putObject("test-get2.txt", "This is the contents of the file. 👻");
    const response = await client.getPartialObject("test-get2.txt", { offset: 12, length: 8 });
    assertEquals(await response.text(), "contents");
  },
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// non-ascii characters in URLs

for (
  const path of [
    "simple.txt",
    "файл/gemütlich.txt",
    "path with spaces.txt",
    "yes&no.dat",
    "foo(bar)",
    "1+1=2",
    "~backup<crazy>.foo",
  ]
) {
  Deno.test({
    name: `get/put/list with unicode or special characters in URLs: ${path}`,
    // only: true,
    fn: async () => {
      const prefix = `filenames-test-${(Math.random() + 1).toString(36).substring(7)}/`;
      const contents = `This is the contents of the file called '${path}'.`;
      await client.putObject(prefix + path, contents);
      const response = await client.getObject(prefix + path);
      assertEquals(await response.text(), contents);
      const names = [];
      for await (const entry of client.listObjects({ prefix })) {
        names.push(entry.key);
      }
      assertEquals(names, [prefix + path]);
    },
  });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// presignedGetObject()

Deno.test({
  name: "presignedGetObject() can create a pre-signed URL to download a file.",
  fn: async () => {
    const contents = "This is the contents of the file. 👻"; // Throw in an Emoji to ensure Unicode round-trip is working.
    await client.putObject("test-presigned.cstm", contents);
    const presignedUrl = await client.presignedGetObject("test-presigned.cstm", {
      // Also try overriding a response parameter
      responseParams: { "response-content-type": "custom/content-type" },
    });
    // Now use the pre-signed URL to download the file
    const response = await fetch(presignedUrl);
    assertEquals(await response.text(), contents);
    assertEquals(await response.headers.get("Content-Type"), "custom/content-type");
  },
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// listObjects()

Deno.test({
  name: "listObjects() can return an empty list when no keys match the prefix",
  fn: async () => {
    const response = client.listObjects({ prefix: "NO MATCH" });
    assertEquals(await response.next(), { done: true, value: undefined });
  },
});

Deno.test({
  name: "listObjects() can return a flat list of objects under a certain prefix",
  fn: async () => {
    const prefix = "list-objects-test-1/";
    await client.putObject(`not-under-that-prefix.txt`, "file Zero");
    await client.putObject(`${prefix}file-a.txt`, "file A");
    await client.putObject(`${prefix}file-b.txt`, "file B");
    await client.putObject(`${prefix}subpath/file-c.txt`, "file C");
    await client.putObject(`${prefix}subpath/file-d.txt`, "file D");
    const response = client.listObjects({ prefix });
    const results = [];
    for await (const result of response) {
      results.push(result);
    }
    assertEquals(results.length, 4);
    assertEquals(results[0].key, "list-objects-test-1/file-a.txt");
    assertEquals(results[0].etag, "31d97c4d04593b21b399ace73b061c34");
    assertEquals(results[0].size, 6);
    assertEquals(results[0].type, "Object");
    assertEquals(results[0].lastModified instanceof Date, true);
    // This test may occasionally be flaky if run at the very instant we're changing to a new month
    // or a new year, but that's OK:
    assertEquals(results[0].lastModified.getFullYear(), new Date().getFullYear());
    assertEquals(results[0].lastModified.getMonth(), new Date().getMonth());

    assertEquals(results[1].key, "list-objects-test-1/file-b.txt");
    assertEquals(results[1].etag, "1651d570b74339e94cace90cde7d3147");
    assertEquals(results[2].key, "list-objects-test-1/subpath/file-c.txt");
    assertEquals(results[3].key, "list-objects-test-1/subpath/file-d.txt");
  },
});

Deno.test({
  name: "listObjects() can return a flat list of objects, spanning multiple pages",
  fn: async () => {
    const prefix = "list-objects-test-2/";
    // Create 30 files, in parallel
    const putPromises = [];
    for (let i = 0; i < 30; i++) {
      putPromises.push(client.putObject(`${prefix}file-${i < 10 ? "0" : ""}${i}.txt`, `file ${i} contents`));
    }
    await Promise.all(putPromises);
    // Now retrieve them:
    const response = client.listObjects({ prefix, pageSize: 10 });
    const results = [];
    for await (const result of response) {
      results.push(result);
    }
    assertEquals(results.length, 30);
    assertEquals(results[0].key, `${prefix}file-00.txt`);
    assertEquals(results[29].key, `${prefix}file-29.txt`);

    // And it can limit the total number of results:
    const limitedResponse = client.listObjects({ prefix, pageSize: 10, maxResults: 25 });
    const limitedResults = [];
    for await (const result of limitedResponse) {
      limitedResults.push(result);
    }
    assertEquals(limitedResults.length, 25);
  },
});

Deno.test({
  name: "listObjectsGrouped() can group results using a delimiter",
  fn: async () => {
    const prefix = "list-objects-test-3/";
    await client.putObject(`${prefix}file-a.txt`, "file A");
    await client.putObject(`${prefix}file-b.txt`, "file B");
    await client.putObject(`${prefix}subpath-1/file-1-a.txt`, "file 1A");
    await client.putObject(`${prefix}subpath-1/file-1-b.txt`, "file 1B");
    await client.putObject(`${prefix}subpath-2/file-2-a.txt`, "file 1A");
    await client.putObject(`${prefix}subpath-2/file-2-b.txt`, "file 1B");
    await client.putObject(`${prefix}x-file.txt`, "file X");

    const response = client.listObjectsGrouped({ prefix, delimiter: "/", pageSize: 3 });
    const results = [];
    for await (const result of response) {
      results.push(result);
    }
    assertEquals(results.length, 5);
    // Note the order that we get the results in:
    assert(results[0].type === "Object");
    assertEquals(results[0].key, `${prefix}file-a.txt`);
    assert(results[1].type === "Object");
    assertEquals(results[1].key, `${prefix}file-b.txt`);
    assert(results[2].type === "CommonPrefix");
    assertEquals(results[2].prefix, `${prefix}subpath-1/`);
    assert(results[3].type === "CommonPrefix");
    assertEquals(results[3].prefix, `${prefix}subpath-2/`);
    assert(results[4].type === "Object");
    assertEquals(results[4].key, `${prefix}x-file.txt`);
  },
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// copyObject()

Deno.test({
  name: "copyObject() can copy a file",
  fn: async () => {
    const contents = "This is the contents of the copy test file. 👻"; // Throw in an Emoji to ensure Unicode round-trip is working.
    const sourceKey = "test-copy-source.txt";
    const destKey = "test-copy-dest.txt";

    // Create the source file:
    const uploadResult = await client.putObject(sourceKey, contents);
    // Make sure the destination doesn't yet exist:
    await client.deleteObject(destKey);
    assertEquals(await client.exists(destKey), false);

    const response = await client.copyObject({ sourceKey }, destKey);
    assertEquals(uploadResult.etag, response.etag);
    assertEquals(uploadResult.versionId, response.copySourceVersionId);
    assertInstanceOf(response.lastModified, Date);

    // Download the file to confirm that the copy worked.
    const downloadResult = await client.getObject(destKey);
    assertEquals(await downloadResult.text(), contents);
  },
});

Deno.test({
  name: "copyObject() gives an appropriate error if the source file doesn't exist.",
  fn: async () => {
    const sourceKey = "non-existent-source";
    const err = await assertRejects(
      () => client.copyObject({ sourceKey }, "any-dest.txt"),
    );
    assertInstanceOf(err, S3Errors.ServerError);
    assertEquals(err.code, "NoSuchKey");
    assertEquals(err.statusCode, 404);
    assertEquals(err.key, sourceKey);
    assertEquals(err.message, "The specified key does not exist.");
  },
});
