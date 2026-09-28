import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {{ distDir: string, version: string, appVersion: string }} VerificationOptions */

/** Verify the files that the GitHub release will expose to electron-updater.
 * @param {VerificationOptions} options
 */
export function verifyUpdateArtifacts({ distDir, version, appVersion }) {
  if (appVersion !== version) throw new Error(`packaged app version ${appVersion} != release ${version}`);
  const names = readdirSync(distDir);
  const zips = names.filter((name) => name.endsWith(".zip"));
  if (zips.length !== 1) throw new Error(`expected one update zip, found ${zips.length}`);
  const zip = zips[0];
  const blockmap = join(distDir, `${zip}.blockmap`);
  if (!names.includes(`${zip}.blockmap`) || statSync(blockmap).size === 0) {
    throw new Error(`missing or empty ${zip}.blockmap`);
  }

  const manifest = readFileSync(join(distDir, "latest-mac.yml"), "utf8");
  const lines = manifest.split(/\r?\n/);
  if (!lines.includes(`version: ${version}`)) {
    throw new Error(`latest-mac.yml version != ${version}`);
  }
  /** @type {{ sha512?: string, size?: number } | null} */
  let entry = null;
  for (const line of lines) {
    const url = line.match(/^\s*- url: (.+)$/);
    if (url) entry = url[1].replace(/^['"]|['"]$/g, "") === zip ? {} : null;
    else if (entry) {
      const hash = line.match(/^\s+sha512: (.+)$/);
      const size = line.match(/^\s+size: (\d+)$/);
      if (hash) entry.sha512 = hash[1];
      if (size) entry.size = Number(size[1]);
    }
    if (entry?.sha512 && entry?.size != null) break;
  }
  if (!entry?.sha512 || entry.size == null) throw new Error(`${zip} missing from latest-mac.yml`);
  const bytes = readFileSync(join(distDir, zip));
  if (bytes.length === 0) throw new Error(`${zip} is empty`);
  if (entry.size !== bytes.length) throw new Error(`${zip} size differs from latest-mac.yml`);
  if (entry.sha512 !== createHash("sha512").update(bytes).digest("base64")) {
    throw new Error(`${zip} sha512 differs from latest-mac.yml`);
  }
  return `${version}: packaged app, update zip, blockmap and latest-mac.yml agree`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [distDir, version, appVersion] = process.argv.slice(2);
  if (!distDir || !version || !appVersion) throw new Error("usage: verify-update-artifacts.mjs <dist> <version> <app-version>");
  console.log(verifyUpdateArtifacts({ distDir, version, appVersion }));
}
