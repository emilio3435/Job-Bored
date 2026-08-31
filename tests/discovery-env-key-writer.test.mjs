/**
 * F0-B named claim F0B-SEC03-ENV: env-key writer must reject control
 * characters and write a single structured assignment. Newline/CR/NUL in
 * the value must never append extra keys.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  parseEnvFile,
  upsertBrowserUseDiscoveryEnvValue,
} from "../scripts/bootstrap-local-discovery.mjs";

describe("F0B-SEC03-ENV — upsertBrowserUseDiscoveryEnvValue", () => {
  let tempDir;
  let envPath;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "jobbored-env-key-"));
    envPath = join(tempDir, ".env");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {
      // best-effort
    }
  });

  it("rejects a newline-injected value and leaves the env file unchanged", () => {
    writeFileSync(envPath, "EXISTING=keep\n", "utf8");
    assert.throws(
      () =>
        upsertBrowserUseDiscoveryEnvValue(
          "SERPAPI_API_KEY",
          "ok\nOTHER_KEY=pwned",
          envPath,
        ),
      (err) => {
        assert.equal(err && err.code, "ENV_VALUE_CONTROL_CHARS");
        return true;
      },
    );
    const text = readFileSync(envPath, "utf8");
    assert.equal(text, "EXISTING=keep\n");
    assert.equal(Object.hasOwn(parseEnvFile(text), "OTHER_KEY"), false);
    assert.equal(Object.hasOwn(parseEnvFile(text), "SERPAPI_API_KEY"), false);
  });

  it("rejects CR in the value", () => {
    writeFileSync(envPath, "EXISTING=keep\n", "utf8");
    assert.throws(
      () =>
        upsertBrowserUseDiscoveryEnvValue(
          "SERPAPI_API_KEY",
          "ok\rOTHER_KEY=pwned",
          envPath,
        ),
      (err) => err && err.code === "ENV_VALUE_CONTROL_CHARS",
    );
    assert.equal(readFileSync(envPath, "utf8"), "EXISTING=keep\n");
  });

  it("rejects NUL in the value", () => {
    writeFileSync(envPath, "EXISTING=keep\n", "utf8");
    assert.throws(
      () =>
        upsertBrowserUseDiscoveryEnvValue(
          "SERPAPI_API_KEY",
          "ok\u0000OTHER_KEY=pwned",
          envPath,
        ),
      (err) => err && err.code === "ENV_VALUE_CONTROL_CHARS",
    );
    assert.equal(readFileSync(envPath, "utf8"), "EXISTING=keep\n");
  });

  it("rejects other control characters such as ESC", () => {
    assert.throws(
      () =>
        upsertBrowserUseDiscoveryEnvValue(
          "SERPAPI_API_KEY",
          "ok\u001b[31m",
          envPath,
        ),
      (err) => err && err.code === "ENV_VALUE_CONTROL_CHARS",
    );
    assert.equal(existsSync(envPath), false);
  });

  it("writes only the allowlisted key as a single structured assignment", () => {
    const result = upsertBrowserUseDiscoveryEnvValue(
      "SERPAPI_API_KEY",
      "only-this-value",
      envPath,
    );
    assert.equal(result.mode, "created");
    const text = readFileSync(envPath, "utf8");
    const parsed = parseEnvFile(text);
    assert.equal(parsed.SERPAPI_API_KEY, "only-this-value");
    assert.equal(Object.hasOwn(parsed, "OTHER_KEY"), false);
    const assignmentLines = text
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    assert.equal(assignmentLines.length, 1);
    assert.match(assignmentLines[0], /^SERPAPI_API_KEY=/);
    assert.equal(assignmentLines[0].includes("\n"), false);
  });

  it("replaces an existing assignment without appending extra keys", () => {
    writeFileSync(
      envPath,
      "SERPAPI_API_KEY=old\nBROWSER_USE_DISCOVERY_GEMINI_API_KEY=keep\n",
      "utf8",
    );
    const result = upsertBrowserUseDiscoveryEnvValue(
      "SERPAPI_API_KEY",
      "new-value",
      envPath,
    );
    assert.equal(result.mode, "updated");
    const parsed = parseEnvFile(readFileSync(envPath, "utf8"));
    assert.equal(parsed.SERPAPI_API_KEY, "new-value");
    assert.equal(parsed.BROWSER_USE_DISCOVERY_GEMINI_API_KEY, "keep");
    assert.equal(Object.keys(parsed).length, 2);
  });
});
