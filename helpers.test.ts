import { assertEquals } from "@std/assert/equals";
import {
  bin2hex,
  isValidBucketName,
  isValidObjectName,
  isValidPort,
  isValidPrefix,
  makeDateLong,
  makeDateShort,
  sha256digestHex,
} from "./helpers.ts";

Deno.test({
  name: "isValidPort",
  fn: () => {
    // ❌ Invalid:
    assertEquals(isValidPort(-50), false);
    assertEquals(isValidPort(0), false);
    assertEquals(isValidPort(90_000), false);
    assertEquals(isValidPort(NaN), false);
    assertEquals(isValidPort(Infinity), false);
    // @ts-expect-error isValidPort normally accepts a number
    assertEquals(isValidPort("foobar"), false);
    // ✅ Valid:
    assertEquals(isValidPort(123), true);
    assertEquals(isValidPort(80), true);
    assertEquals(isValidPort(443), true);
    assertEquals(isValidPort(9000), true);
  },
});

Deno.test({
  name: "isValidBucketName",
  fn: async (t) => {
    // ❌ Invalid:
    for (
      const invalidName of [
        undefined,
        "",
        "ab", // too short
        "has_underscore", // no underscores
        "test..bar", // double periods
        // too long:
        "propellane-possesses-omniphilic-reactivity-anions-and-radicals-add-towards-the-interbridgehead-bond-because-the-tridimensional-vacuum-constant-is-weaker-in-the-magnetic-flux-from-the-pseudo-electromagnetic-field-generated-by-the-subspace-distortion-of-the-integrated-hypercapacitor",
        "-hyphen-", // must start/end with letters/numbers
      ] as unknown as string[]
    ) {
      await t.step({
        name: `"${invalidName}" is not a valid bucket name`,
        fn: () => assertEquals(isValidBucketName(invalidName), false),
      });
    }
    // ✅ Valid:
    for (
      const validName of [
        "bucket",
        "bucket-23",
        "test.bucket.com",
        "Capitalized.Backblaze.Bucket",
      ] as unknown as string[]
    ) {
      await t.step({
        name: `"${validName}" is a valid bucket name`,
        fn: () => assertEquals(isValidBucketName(validName), true),
      });
    }
  },
});

Deno.test({
  name: "isValidObjectName",
  fn: () => {
    // ✅ Valid:
    assertEquals(isValidObjectName("file.txt"), true);
    assertEquals(isValidObjectName("dir/sub dir/file (final)+v2.txt"), true);
    assertEquals(isValidObjectName("x".repeat(1024)), true);
    assertEquals(isValidObjectName("файл"), true);
    assertEquals(isValidObjectName("emoji-😀.txt"), true);
    // ❌ Invalid:
    assertEquals(isValidObjectName(""), false); // empty
    assertEquals(isValidObjectName("x".repeat(1025)), false); // too long
    // @ts-expect-error isValidObjectName normally accepts a string
    assertEquals(isValidObjectName(undefined), false);
    // A lone surrogate cannot be represented in UTF-8, so such a key can never reach the server as
    // written. It must be rejected here rather than silently mangled into U+FFFD:
    assertEquals(isValidObjectName("\ud800"), false); // lone high surrogate
    assertEquals(isValidObjectName("\udfff"), false); // lone low surrogate
    assertEquals(isValidObjectName("dir/lone\ud800surrogate.txt"), false);
  },
});

Deno.test({
  name: "isValidPrefix",
  fn: () => {
    // ✅ Valid:
    assertEquals(isValidPrefix(""), true); // unlike an object name, a prefix may be empty
    assertEquals(isValidPrefix("dir/"), true);
    assertEquals(isValidPrefix("emoji-😀"), true);
    // ❌ Invalid:
    assertEquals(isValidPrefix("x".repeat(1025)), false); // too long
    assertEquals(isValidPrefix("dir/\ud800"), false); // lone surrogate
  },
});

Deno.test({
  name: "makeDateShort",
  fn: () => {
    const date = new Date("2012-12-03T17:25:36.331Z");
    assertEquals(makeDateShort(date), "20121203");
  },
});

Deno.test({
  name: "makeDateLong",
  fn: () => {
    const date = new Date("2017-08-11T17:26:34.935Z");
    assertEquals(makeDateLong(date), "20170811T172634Z");
  },
});

Deno.test({
  name: "bin2hex",
  fn: () => {
    assertEquals(
      bin2hex(new Uint8Array([0xab, 0xcd, 0x00, 0x01, 0x00, 0xc0, 0xff, 0xee])),
      "abcd000100c0ffee",
    );
  },
});

Deno.test({
  name: "sha256digestHex",
  fn: async () => {
    assertEquals(
      await sha256digestHex("data"),
      "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7",
    );
    assertEquals(
      await sha256digestHex(""),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  },
});
