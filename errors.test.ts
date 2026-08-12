import { assert } from "@std/assert/assert";
import { assertEquals } from "@std/assert/equals";
import * as errors from "./errors.ts";

Deno.test({
  name: "every error class reports its own class name as .name",
  fn: () => {
    // Find every error class this module exports, so that classes added in future are covered too:
    const errorClasses = Object.entries(errors).filter(
      ([, value]) => typeof value === "function" && value.prototype instanceof Error,
    ) as [string, new (arg?: unknown) => Error][];
    // Sanity check that the filter above actually found them:
    assert(errorClasses.length >= 9, `expected to find the error classes, found ${errorClasses.length}`);

    for (const [exportName, ErrorClass] of errorClasses) {
      const instance = new ErrorClass("test");
      assertEquals(instance.name, ErrorClass.name, `${exportName} should report its class name as .name`);
      // Which means the class name also shows up when the error is stringified or logged.
      // (Not every class takes a message as its first argument, so the message may be empty here.)
      assert(
        String(instance).startsWith(ErrorClass.name),
        `${exportName} should be stringified starting with its class name, got "${String(instance)}"`,
      );
    }
  },
});

Deno.test({
  name: "error names are useful for diagnostics",
  fn: async () => {
    // A subclass with its own constructor:
    assertEquals(new errors.InvalidBucketNameError("Bad_Bucket").name, "InvalidBucketNameError");
    assertEquals(
      String(new errors.InvalidObjectNameError("bad/name")),
      "InvalidObjectNameError: Invalid object name: bad/name",
    );
    // A subclass with no constructor of its own:
    assertEquals(new errors.InvalidArgumentError("nope").name, "InvalidArgumentError");
    // The base class itself:
    assertEquals(new errors.S3Error("generic").name, "S3Error");
    // And errors parsed from a server response:
    const parsed = await errors.parseServerError(
      new Response(`<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>`, { status: 404 }),
    );
    assertEquals(parsed.name, "ServerError");
    assertEquals(parsed.code, "NoSuchKey"); // The S3 error code is still separate from the class name
  },
});

Deno.test({
  name: "S3Error still accepts the standard Error options argument",
  fn: () => {
    const cause = new Error("the underlying problem");
    const err = new errors.S3Error("wrapper", { cause });
    assertEquals(err.cause, cause);
    assertEquals(err.name, "S3Error");
  },
});
