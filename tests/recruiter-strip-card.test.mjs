/**
 * UX-01 card half: the compact strip must keep every CRM slot visible and say
 * Unknown for absent evidence rather than rendering blanks or invented facts.
 * Mutation check: blanking any missing value or omitting the compact adjacency
 * hook fails this probe.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "recruiter-strip.js");

it("renders the compact card variant with Unknown preserved", () => {
  const windowTarget = { JobBoredApp: { sheetsWrite: {} } };
  if (existsSync(sourcePath)) {
    vm.runInNewContext(readFileSync(sourcePath, "utf8"), {
      Object,
      String,
      window: windowTarget,
    }, { filename: "recruiter-strip.js" });
  }
  assert.ok(
    windowTarget.JobBoredRecruiterStrip,
    "UX-01: recruiter-strip.js must install its compact renderer",
  );

  const mount = { innerHTML: "", addEventListener() {}, querySelector() { return null; } };
  windowTarget.JobBoredRecruiterStrip.renderCompact(mount, {
    jobKey: "11",
    contact: "",
    lastHeardFrom: null,
    replied: "",
    followUpDate: undefined,
  });

  assert.match(mount.innerHTML, /pipe-sticker__recruiter-strip/);
  assert.equal((mount.innerHTML.match(/Unknown/g) || []).length >= 4, true);
  assert.doesNotMatch(mount.innerHTML, /undefined|null/);
  assert.match(mount.innerHTML, /Find a recruiter contact/);
});
