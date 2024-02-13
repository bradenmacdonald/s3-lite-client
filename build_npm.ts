import { build, emptyDir } from "https://deno.land/x/dnt/mod.ts";

const version = Deno.args[0];

if (!version) {
  throw new Error("Please specify a version.");
}

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"], // Replace with your actual entry point
  outDir: "./npm",
  shims: {
    // Add shims as necessary for your project
    deno: true,
    custom: [
      {
        package: {
          name: "web-streams-polyfill",
          version: "^3.1.1",
        },
        globalNames: ["ReadableStream", "WritableStream", "TransformStream"],
      },
    ],
  },
  package: {
    // Update with your package details
    name: "@capgo/s3-lite-client",
    version: version,
    description: "This is a lightweight S3 client for Node.js and Deno.",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/riderx/deno-s3-lite-client.git",
    },
    bugs: {
      url: "https://github.com/riderx/deno-s3-lite-client/issues",
    },
  },
  postBuild() {
    // Copy additional files to the npm directory if needed
    Deno.copyFileSync("LICENSE", "npm/LICENSE");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});

console.log("Build complete. Run `npm publish` in the `npm` directory.");
