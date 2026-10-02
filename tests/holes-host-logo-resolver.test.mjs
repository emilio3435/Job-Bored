/**
 * HOLES HOST S15: the brand-logo resolver is a python3 child that fetches
 * remote logos. It was spawned with the server's whole environment (every
 * provider key and the hosted API token), and when it failed its stderr — a
 * Python traceback naming server paths — became the error message sent to
 * the browser.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { runResolver } from "../server/brand-logos.mjs";

const SECRET_ENV = {
  GEMINI_API_KEY: "AIzaHolesHostFakeKey000000000000000",
  JOBBORED_API_TOKEN: "holes-host-hosted-token",
};
const TRACEBACK = [
  "Traceback (most recent call last):",
  '  File "/opt/jobbored/integrations/hermes-job-hunt/scripts/logo_resolver.py", line 9',
  "RuntimeError: upstream said key=sk-holeshostfake0123456789",
].join("\n");

describe("HOLES HOST S15 — logo resolver child process", () => {
  let root = "";
  /** @type {Record<string, string | undefined>} */
  const previous = {};
  /** @type {typeof console.warn} */
  let warn;
  /** @type {string[]} */
  let warnings = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "holes-host-logos-"));
    mkdirSync(join(root, "templates"), { recursive: true });
    writeFileSync(join(root, "templates", "logos.json"), JSON.stringify({ logos: [{ slug: "acme", label: "Acme" }] }));
    const script = join(root, "logo_resolver.py");
    writeFileSync(script, "# never run: the fake interpreter below stands in for python3\n");
    // A stand-in python3: records the environment it was given, then fails
    // the way a crashed resolver does.
    const python = join(root, "fake-python3");
    writeFileSync(
      python,
      `#!/bin/sh\nenv > "$3/child-env.txt"\ncat >&2 <<'TRACE'\n${TRACEBACK}\nTRACE\nexit 1\n`,
    );
    chmodSync(python, 0o755);
    for (const [key, value] of Object.entries({ ...SECRET_ENV, HERMES_LOGO_RESOLVER_SCRIPT: script })) {
      previous[key] = process.env[key];
      process.env[key] = value;
    }
    warnings = [];
    warn = console.warn;
    console.warn = (...args) => {
      warnings.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.warn = warn;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  /** Run the resolver against the fake interpreter; it always fails. */
  async function failedRun() {
    const templateRoot = join(root, "templates");
    let caught = null;
    try {
      await runResolver({
        templateRoot,
        pythonExecutable: join(root, "fake-python3"),
        env: {},
        platform: "linux",
        probeDeveloperTools: () => true,
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "the fake resolver fails");
    return { error: /** @type {Error & { statusCode?: number }} */ (caught), childEnv: readFileSync(join(templateRoot, "child-env.txt"), "utf8") };
  }

  it("never hands the server's keys and tokens to the child", async () => {
    const { childEnv } = await failedRun();
    // Compare key names and booleans only: a failure must never print the
    // child's environment into a test log.
    const keys = new Set(childEnv.split("\n").map((line) => line.split("=")[0]));
    assert.equal(keys.has("PATH"), true, "the child still gets a PATH");
    for (const [key, value] of Object.entries(SECRET_ENV)) {
      assert.equal(keys.has(key), false, `${key} reached the resolver`);
      assert.equal(childEnv.includes(value), false, `${key}'s value reached the resolver`);
    }
  });

  it("keeps the traceback out of the error the browser receives", async () => {
    const { error } = await failedRun();
    assert.equal(error.statusCode, 502);
    assert.doesNotMatch(error.message, /Traceback|logo_resolver\.py|sk-holeshost|\/opt\//);
  });

  it("logs the traceback server-side with secrets redacted", async () => {
    await failedRun();
    const logged = warnings.join("\n");
    assert.match(logged, /Traceback/);
    assert.doesNotMatch(logged, /sk-holeshostfake0123456789/);
  });
});
