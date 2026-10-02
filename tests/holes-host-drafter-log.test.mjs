/**
 * HOLES HOST S17: when a draft failed, the drafter logged the raw error
 * object. A provider error can carry the request's headers and the upstream
 * body, so the server log (and any log shipper behind it) received API keys.
 * The log keeps the failure code and a redacted message and stack.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { format } from "node:util";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createMaterialsDrafter } from "../server/materials-drafter.mjs";
import { EXAMPLE_RESUME_SOURCE } from "./fixtures/materials-pipeline-stub.mjs";

const AUTH_HEADER_SECRET = "sk-holeshostdrafter0123456789";
const KEY_IN_MESSAGE = "AIzaHolesHostDrafterKey00000000000";
const POSTING = Array(120).fill("Own the roadmap and ship measurable outcomes.").join(" ");

describe("HOLES HOST S17 — drafter failure log", () => {
  let root = "";
  /** @type {typeof console.error} */
  let consoleError;
  /** @type {string[]} */
  let logged = [];
  /** @type {string | undefined} */
  let previousProfile;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "holes-host-drafter-"));
    previousProfile = process.env.JOBBORED_PROFILE_PATH;
    process.env.JOBBORED_PROFILE_PATH = join(root, "home", "profile.json");
    logged = [];
    consoleError = console.error;
    console.error = (...args) => {
      logged.push(format(...args));
    };
  });

  afterEach(() => {
    console.error = consoleError;
    if (previousProfile === undefined) delete process.env.JOBBORED_PROFILE_PATH;
    else process.env.JOBBORED_PROFILE_PATH = previousProfile;
    rmSync(root, { recursive: true, force: true });
  });

  it("logs the failure without the provider's headers, body or key", async () => {
    const providerError = Object.assign(new Error(`Gemini HTTP 400 for ?key=${KEY_IN_MESSAGE}`), {
      config: { headers: { Authorization: `Bearer ${AUTH_HEADER_SECRET}` } },
      response: { data: { error: { message: `API key ${KEY_IN_MESSAGE} not valid` } } },
    });
    const drafter = createMaterialsDrafter({
      applicationsRoot: join(root, "applications"),
      loadPin: () => ({ provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "" }),
      resolvePin: async () => {
        throw providerError;
      },
      readSavedResume: async () => null,
      openSession: null,
      intel: false,
      logoLoader: async () => [],
      targetLogoLoader: async () => null,
      employerLogoLoader: async () => [],
    });
    await drafter.enqueue({
      resume: EXAMPLE_RESUME_SOURCE,
      slug: "acme-pm",
      company: "Acme",
      title: "Product Manager",
      feature: "resume",
      jobUrl: "https://example.com/jobs/1",
      notes: "",
      jobDescription: POSTING,
    });
    await drafter.runUntilIdle();

    const text = logged.join("\n");
    assert.match(text, /\[materials\] slug=acme-pm /, "the failure is still logged");
    assert.match(text, /Gemini HTTP 400/, "the message survives for debugging");
    assert.equal(text.includes(AUTH_HEADER_SECRET), false, "the request's auth header reached the log");
    assert.equal(text.includes(KEY_IN_MESSAGE), false, "the API key reached the log");
  });
});
