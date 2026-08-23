import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(scriptDir, "..");
const repositoryRoot = resolve(webRoot, "..");
const publicRoot = resolve(webRoot, "public");

await mkdir(publicRoot, { recursive: true });
await Promise.all([
  copyFile(resolve(repositoryRoot, "LICENSE"), resolve(publicRoot, "LICENSE.txt")),
  copyFile(resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md"), resolve(publicRoot, "THIRD_PARTY_NOTICES.md")),
]);
