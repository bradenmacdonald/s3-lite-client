import { assertEquals } from "@std/assert/equals";
import { childText, parse } from "./xml-parser.ts";

const declaration = `<?xml version="1.0" encoding="UTF-8"?>`;

Deno.test({
  name: "parse - skips the XML declaration",
  fn: async (t) => {
    // Every response from S3 begins with a declaration, which we ignore entirely:
    for (
      const prefix of [
        "",
        declaration,
        `<?xml version="1.0"?>`,
        `<?xml version='1.0' encoding='utf-8'?>`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
        `${declaration}\n  `,
        `<!-- a comment -->`,
        `${declaration}<!-- a comment -->`,
      ]
    ) {
      await t.step({
        name: `prefixed with ${JSON.stringify(prefix) || "nothing"}`,
        fn: () => {
          const root = parse(`${prefix}<Root><Child>value</Child></Root>`);
          assertEquals(root?.name, "Root");
          assertEquals(childText(root!, "Child"), "value");
        },
      });
    }
  },
});

Deno.test({
  name: "parse - returns undefined when there is no root element",
  fn: () => {
    assertEquals(parse(""), undefined);
    assertEquals(parse("   "), undefined);
    assertEquals(parse("not xml at all"), undefined);
    assertEquals(parse(declaration), undefined);
  },
});

Deno.test({
  name: "parse - elements, attributes, and entities",
  fn: () => {
    const root = parse(
      `${declaration}<Root attr="v" other='w'><Empty/><Text>hello</Text><Esc>&lt;a&gt; &amp; b</Esc></Root>`,
    );
    assertEquals(root?.name, "Root");
    assertEquals(root?.attributes, { attr: "v", other: "w" });
    assertEquals(root?.children.map((c) => c.name), ["Empty", "Text", "Esc"]);
    assertEquals(childText(root!, "Text"), "hello");
    // Basic entities are decoded:
    assertEquals(childText(root!, "Esc"), "<a> & b");
    // Namespaced tag names are kept as-is:
    assertEquals(parse(`<ns:Root xmlns:ns="urn:x"><ns:Child>v</ns:Child></ns:Root>`)?.name, "ns:Root");
  },
});

Deno.test({
  name: "childText",
  fn: () => {
    // A realistic ListObjectsV2 response:
    const root = parse(`${declaration}
      <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
        <Name>test-bucket</Name>
        <IsTruncated>true</IsTruncated>
        <NextContinuationToken>token-abc</NextContinuationToken>
        <Contents>
          <Key>dir/file.txt</Key>
          <LastModified>2024-01-01T00:00:00.000Z</LastModified>
          <ETag>&#34;d41d8cd9&#34;</ETag>
          <Size>1234</Size>
        </Contents>
      </ListBucketResult>`)!;

    assertEquals(root.name, "ListBucketResult");
    assertEquals(childText(root, "IsTruncated"), "true");
    assertEquals(childText(root, "NextContinuationToken"), "token-abc");
    // Missing children are undefined, not an error:
    assertEquals(childText(root, "NoSuchElement"), undefined);
    // It only looks at direct children, not deeper descendants:
    assertEquals(childText(root, "Key"), undefined);

    const contents = root.children.find((c) => c.name === "Contents")!;
    assertEquals(childText(contents, "Key"), "dir/file.txt");
    assertEquals(childText(contents, "Size"), "1234");

    // Where an element is repeated, the first one wins:
    const dup = parse(`<Root><Dup>1</Dup><Dup>2</Dup></Root>`)!;
    assertEquals(childText(dup, "Dup"), "1");
  },
});
