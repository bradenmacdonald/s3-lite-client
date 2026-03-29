// Helper script to download a published JSR package and then get it ready for upload it to NPM
// Run it from the repo root with:
// deno run --allow-run --allow-write .github/workflows/publish.ts
// Then cd into the `node_modules/.../` folder and run `npm publish`

const jsrPackageName = "@bradenmacdonald/s3-lite-client";
const npmPackageName = "@bradenmacdonald/s3-lite-client";
const npmPackageExtra = {
  description: "A lightweight S3 client.",
  repository: "github:bradenmacdonald/s3-lite-client",
};

////////////////////////////////////////////////////////

import denoPackageMetadata from "../../deno.json" with { type: "json" };

const version = denoPackageMetadata.version;

const addCmd = new Deno.Command("npx", { args: ["--yes", "jsr", "add", `${jsrPackageName}@${version}`] });
const addResult = await addCmd.output();
if (!addResult.success) {
  throw new Error("Failed to install s3-lite-client as an NPM package.");
}

// Update the new package.json with appropriate fields:
const newPackageJsonPath = `node_modules/${jsrPackageName}/package.json`;
const origPackageJson = (await import(`../../${newPackageJsonPath}`, { with: { type: "json" } })).default;

const newPackageJson = {
  ...origPackageJson,
  name: npmPackageName,
  license: denoPackageMetadata.license,
  ...npmPackageExtra,
};

await Deno.writeTextFile(newPackageJsonPath, JSON.stringify(newPackageJson, undefined, 2));
