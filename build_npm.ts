import { build, emptyDir } from "https://deno.land/x/dnt@0.40.0/mod.ts";

const version = Deno.args[0];

if (!version) {
  throw new Error("Please specify a version.");
}

await emptyDir("./npm");

await build({
  entryPoints: ["./mod.ts"], // Replace with your actual entry point
  outDir: "./npm",
  testPattern: "**/*(*.test|integration).{ts,tsx,js,mjs,jsx}",
  shims: {
    deno: {
      test: "dev",
    },
  },
  compilerOptions: {
    lib: ["ESNext", "DOM"],
  },
  mappings: {
    "node:stream/web": {
      name: "node:stream/web",
    },
  },
  package: {
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
      "node": ">=20",
    },
    author: {
      "name": "Braden MacDonald",
      "url": "https://github.com/bradenmacdonald",
    },
    contributors: [
      "Martin Donadieu <martindonadieu@gmail.com> (https://martin.solos.ventures/)",
    ],
    devDependencies: {
      "@types/node": "^20.11.1",
    },
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

console.log("Build complete. Run `cd npm && npm publish && cd ..`.");
