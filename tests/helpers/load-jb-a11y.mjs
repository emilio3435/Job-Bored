import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const JB_A11Y_JS = join(repoRoot, "jb-a11y.js");
export const JB_A11Y_CSS = join(repoRoot, "jb-a11y.css");
export const PHONE_GEOMETRY_JSON = join(
  repoRoot,
  "tests",
  "fixtures",
  "phone-geometry.json",
);

export function assertJbA11yModuleExists() {
  assert.ok(
    existsSync(JB_A11Y_JS),
    "F3-D shared primitive jb-a11y.js is missing",
  );
  assert.ok(
    existsSync(JB_A11Y_CSS),
    "F3-D shared primitive jb-a11y.css is missing",
  );
}

export function loadJobBoredA11y(document, window) {
  assertJbA11yModuleExists();
  const src = readFileSync(JB_A11Y_JS, "utf8");
  const sandbox = {
    window,
    document,
    globalThis: window,
    console,
  };
  vm.runInNewContext(src, sandbox, { filename: "jb-a11y.js" });
  assert.ok(
    window.JobBoredA11y,
    "jb-a11y.js must attach window.JobBoredA11y",
  );
  return window.JobBoredA11y;
}
