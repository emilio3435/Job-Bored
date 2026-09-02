/**
 * Tests for server/materials-request.mjs — request body validation and
 * enqueue delegation for the in-process materials drafter.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeRequestBody,
  spawnMaterialsRequest,
} from "../server/materials-request.mjs";

describe("normalizeRequestBody", () => {
  const valid = {
    slug: "chartis-senior-digital-marketing-consultant",
    company: "Chartis",
    title: "Senior Digital Marketing Consultant",
    feature: "cover_letter",
    jobUrl: "https://example.com/jobs/1",
    notes: "Tighten the opening paragraph.",
  };

  it("accepts a fully-formed body", () => {
    const out = normalizeRequestBody(valid);
    assert.deepEqual(out, valid);
  });

  it("rejects invalid slugs", () => {
    assert.throws(
      () => normalizeRequestBody({ ...valid, slug: "../etc/passwd" }),
      (e) => e.statusCode === 400 && /slug/i.test(e.message),
    );
    assert.throws(
      () => normalizeRequestBody({ ...valid, slug: "UPPER" }),
      (e) => e.statusCode === 400,
    );
  });

  it("rejects unknown features", () => {
    assert.throws(
      () => normalizeRequestBody({ ...valid, feature: "rewrite" }),
      (e) => e.statusCode === 400 && /feature/i.test(e.message),
    );
  });

  it("requires company and title", () => {
    assert.throws(
      () => normalizeRequestBody({ ...valid, company: "" }),
      (e) => e.statusCode === 400 && /company/i.test(e.message),
    );
    assert.throws(
      () => normalizeRequestBody({ ...valid, title: "" }),
      (e) => e.statusCode === 400 && /title/i.test(e.message),
    );
  });

  it("caps notes to a reasonable maximum", () => {
    const huge = "x".repeat(50_000);
    const out = normalizeRequestBody({ ...valid, notes: huge });
    assert.ok(out.notes.length <= 4000, "notes should be capped");
  });

  it("trims whitespace and discards \\r so newlines stay consistent", () => {
    const out = normalizeRequestBody({
      ...valid,
      notes: "  line one\r\nline two  ",
    });
    assert.equal(out.notes, "line one\nline two");
  });
});

describe("spawnMaterialsRequest", () => {
  const goodPayload = {
    slug: "test-slug",
    company: "Test Co",
    title: "Test Role",
    feature: "cover_letter",
    jobUrl: "https://example.com/jobs/1",
    notes: "A note",
  };

  it("delegates to options.enqueue and keeps dossier field names", async () => {
    /** @type {unknown} */
    let received = null;
    const result = await spawnMaterialsRequest(goodPayload, {
      enqueue: async (payload) => {
        received = payload;
        return {
          ok: true,
          slug: payload.slug,
          pending_path: "/tmp/x/pending.json",
          requested_at: "2026-05-27T20:00:00Z",
          accepted: true,
        };
      },
    });
    assert.deepEqual(received, goodPayload);
    assert.equal(result.ok, true);
    assert.equal(result.slug, "test-slug");
    assert.equal(result.pending_path, "/tmp/x/pending.json");
    assert.equal(result.requested_at, "2026-05-27T20:00:00Z");
    assert.equal(result.accepted, true);
  });

  it("propagates enqueue errors including 409 llm_unconfigured", async () => {
    await assert.rejects(
      () =>
        spawnMaterialsRequest(goodPayload, {
          enqueue: async () => {
            throw Object.assign(new Error("No LLM pin configured."), {
              statusCode: 409,
              code: "llm_unconfigured",
            });
          },
        }),
      (err) => err.statusCode === 409 && err.code === "llm_unconfigured",
    );
  });
});
