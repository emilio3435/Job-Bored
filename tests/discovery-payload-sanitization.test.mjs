/**
 * Regression tests for the discovery webhook payload sanitization in
 * buildDiscoveryWebhookPayload (app.js).
 *
 * Bug being prevented:
 *   Step 7 wizard "Run test" → worker rejects with
 *     "discoveryProfile.sourcePreset must be one of: browser_only, ats_only,
 *      browser_plus_ats. Received: ''."
 *
 * Root cause: greenfield user has discoveryProfile = {} → if any UI code
 * pre-fills sourcePreset:"" the worker rejects (per contract, the field
 * must either be omitted or one of the enum values).
 *
 * This test verifies that the sanitization step in
 * buildDiscoveryWebhookPayload strips empty/whitespace sourcePreset values
 * before the payload goes to the worker.
 *
 * Lane: feat/discovery-autodetect-silent-recover
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");

describe("buildDiscoveryWebhookPayload — sourcePreset sanitization", () => {
  it("contains the sanitization fence comment", () => {
    assert.ok(
      appJs.includes("[discovery-autodetect lane: contract sanitization]"),
      "sanitization fence comment should be present in app.js",
    );
  });

  it("strips sourcePreset when it's an empty string (regression: Step 7 Run test)", () => {
    // We can't load app.js directly (it expects browser globals), so we
    // assert via static analysis that the sanitization block performs the
    // delete operation.
    const fenceStart = appJs.indexOf(
      "[discovery-autodetect lane: contract sanitization]",
    );
    const fenceEnd = appJs.indexOf(
      "[/discovery-autodetect lane]",
      fenceStart,
    );
    assert.ok(fenceStart !== -1 && fenceEnd > fenceStart, "fence pair found");
    const block = appJs.slice(fenceStart, fenceEnd);
    assert.ok(
      block.includes("delete sanitized.sourcePreset"),
      "must delete empty sourcePreset before send",
    );
    assert.ok(
      block.includes('trimmed === ""'),
      "must check for empty-string sourcePreset",
    );
    assert.ok(
      /Object\.prototype\.hasOwnProperty\.call\(discoveryProfile, "sourcePreset"\)/.test(
        block,
      ),
      "must guard on hasOwnProperty so we don't add the key when missing",
    );
  });

  it("does not mutate the stored discovery profile (clones first)", () => {
    const fenceStart = appJs.indexOf(
      "[discovery-autodetect lane: contract sanitization]",
    );
    const fenceEnd = appJs.indexOf(
      "[/discovery-autodetect lane]",
      fenceStart,
    );
    const block = appJs.slice(fenceStart, fenceEnd);
    assert.ok(
      block.includes("...discoveryProfile"),
      "must spread-clone before mutating to avoid IndexedDB write-through",
    );
  });

  // Pure unit test of the sanitization shape via behavioral simulation.
  it("simulated: empty string sourcePreset is removed", () => {
    function sanitize(discoveryProfile) {
      if (
        discoveryProfile &&
        typeof discoveryProfile === "object" &&
        Object.prototype.hasOwnProperty.call(discoveryProfile, "sourcePreset")
      ) {
        const sp = discoveryProfile.sourcePreset;
        const trimmed = typeof sp === "string" ? sp.trim() : sp;
        if (
          trimmed === "" ||
          trimmed == null ||
          typeof trimmed !== "string"
        ) {
          const sanitized = { ...discoveryProfile };
          delete sanitized.sourcePreset;
          return sanitized;
        }
        if (trimmed !== sp) {
          return { ...discoveryProfile, sourcePreset: trimmed };
        }
      }
      return discoveryProfile;
    }

    assert.deepEqual(sanitize({}), {});
    assert.deepEqual(sanitize({ sourcePreset: "" }), {});
    assert.deepEqual(sanitize({ sourcePreset: "   " }), {});
    assert.deepEqual(sanitize({ sourcePreset: null }), {});
    assert.deepEqual(sanitize({ sourcePreset: undefined }), {});
    assert.deepEqual(sanitize({ sourcePreset: 42 }), {});
    assert.deepEqual(sanitize({ sourcePreset: "browser_only" }), {
      sourcePreset: "browser_only",
    });
    assert.deepEqual(sanitize({ sourcePreset: " ats_only " }), {
      sourcePreset: "ats_only",
    });
    // Other fields preserved.
    assert.deepEqual(
      sanitize({ sourcePreset: "", targetRoles: "Engineer" }),
      { targetRoles: "Engineer" },
    );
    // Original not mutated.
    const original = { sourcePreset: "" };
    sanitize(original);
    assert.equal(original.sourcePreset, "", "original must not be mutated");
  });
});
