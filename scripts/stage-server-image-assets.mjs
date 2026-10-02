import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Copy the materials runtime assets into the server-only Docker context.
 * @param {{ repoRoot?: string, serverDir?: string }} [options]
 */
export function stageServerImageAssets({ repoRoot = root, serverDir = join(repoRoot, "server") } = {}) {
  const staged = join(serverDir, ".image-assets");
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(staged, { recursive: true });
  for (const path of ["schemas", "templates/materials", "vendor/fonts"]) {
    cpSync(join(repoRoot, path), join(staged, path), { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  stageServerImageAssets();
  console.log("Staged schemas, materials templates and fonts for the server image.");
}
