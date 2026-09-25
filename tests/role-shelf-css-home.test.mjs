/**
 * UX01 DS-09 / C4: the Dossier view's empty-state shelf is styled from
 * flowing-chrome.css, scoped under its root class, and role.css no longer
 * carries it (or the rendererless .jb-role-divider).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(repoRoot, f), "utf8");

it("should style the shelf from flowing-chrome.css, under .jb-shelf (DS-09)", () => {
  const chrome = read("flowing-chrome.css");
  for (const cls of ["jb-shelf__title", "jb-shelf__hints", "jb-hint", "jb-hint__title", "jb-shelf__cta"]) {
    assert.match(chrome, new RegExp("body\\.jb-v2 \\.jb-shelf \\." + cls + "\\b"), cls + " is scoped under .jb-shelf");
  }
  const role = read("role.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(role, /\.jb-shelf|\.jb-hint|\.jb-role-divider/);
});
