import { build, emptyDir } from "https://deno.land/x/dnt/mod.ts";

const version = Deno.args[0];

if (!version) {
  throw new Error("Please specify a version.");
}

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"], // Replace with your actual entry point
  outDir: "./npm",
  testPattern: "**/*(*.test|integration).{ts,tsx,js,mjs,jsx}",
  // Filter when we use node stream package
  filterDiagnostic(diagnostic) {
    if (
      diagnostic.messageText.startsWith("Property 'from' does not exist on type '{ new (underlyingSource: UnderlyingByteSource, strategy?: QueuingStrategy<Uint8Array> | undefined): ReadableStream")
    ) {
      return false; // ignore all diagnostics For ReadableStream.from in this file
    }
    return true;
  },
  shims: {
    undici: true, // fix: can copy a file test integration
    deno: {
      test: "dev",
    },
    custom: [
      {
        package: {
          name: "node:stream/web",
        },
        globalNames: ["ReadableStream", "WritableStream", "TransformStream"],
      },
    ],
  },
  package: {
    // Update with your package details
    name: "s3-lite-client",
    version: version,
    description: "This is a lightweight S3 client for Node.js and Deno.",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/bradenmacdonald/deno-s3-lite-client.git",
    },
    bugs: {
      url: "https://github.com/bradenmacdonald/deno-s3-lite-client/issues",
    },
    engines: {
      "node": ">=16",
    },
    author: {
      "name": "Braden MacDonald",
      "url": "https://github.com/bradenmacdonald",
    },
    contributors: [
      "Martin Donadieu <martindonadieu@gmail.com> (https://martin.solos.ventures/)",
    ],
    keywords: [
      "api",
      "lite",
      "amazon",
      "minio",
      "cloud",
      "s3",
      "storage",
    ],
  },
  postBuild() {
    // Copy additional files to the npm directory if needed
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});

console.log("Build complete. Run `cd npm && npm publish`.");
