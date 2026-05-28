import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRepairRequestPayload } from "../server/materials-repair.mjs";

const baseManifest = {
  slug: "entravision-smadex-sales-director-us",
  company: "Entravision",
  title: "Sales Director US",
  jobUrl: "https://example.com/jobs/entravision",
};

describe("buildRepairRequestPayload", () => {
  it("turns sparse resume review issues into an expand-or-collapse request", () => {
    const result = buildRepairRequestPayload({
      ...baseManifest,
      quality: {
        documents: {
          resume: {
            status: "review",
            pageCount: 2,
            words: 482,
            pageWords: [352, 126],
            issues: [
              {
                code: "resume_second_page_sparse",
                message: "Second page has 126 words; expand with relevant evidence or collapse to one page.",
                severity: "review",
              },
              {
                code: "resume_education_missing",
                message: "Resume is missing education.",
                severity: "review",
              },
            ],
          },
        },
      },
    }, { feature: "resume" });

    assert.equal(result.payload.slug, baseManifest.slug);
    assert.equal(result.payload.company, "Entravision");
    assert.equal(result.payload.title, "Sales Director US");
    assert.equal(result.payload.feature, "resume");
    assert.equal(result.payload.jobUrl, baseManifest.jobUrl);
    assert.equal(result.repair.strategy, "expand_or_collapse");
    assert.deepEqual(result.repair.issueCodes, [
      "resume_second_page_sparse",
      "resume_education_missing",
    ]);
    assert.match(result.payload.notes, /Goal: Repair the tailored resume/);
    assert.match(result.payload.notes, /Expand the sparse two-page draft/);
    assert.match(result.payload.notes, /Collapse the draft to one full page/);
    assert.match(result.payload.notes, /resume_second_page_sparse/);
    assert.match(result.payload.notes, /Current page word counts: 352, 126/);
  });

  it("defaults to the first review artifact with resume priority", () => {
    const result = buildRepairRequestPayload({
      ...baseManifest,
      quality: {
        documents: {
          cover_letter: {
            status: "review",
            pageCount: 1,
            words: 280,
            pageWords: [280],
            issues: [{ code: "cover_letter_too_short", message: "Too short." }],
          },
          resume: {
            status: "review",
            pageCount: 2,
            words: 720,
            pageWords: [560, 160],
            issues: [{ code: "resume_second_page_sparse", message: "Second page sparse." }],
          },
        },
      },
    });

    assert.equal(result.payload.feature, "resume");
    assert.equal(result.repair.strategy, "expand_or_collapse");
  });

  it("turns long cover letters into a collapse request", () => {
    const result = buildRepairRequestPayload({
      ...baseManifest,
      quality: {
        documents: {
          cover_letter: {
            status: "fail",
            pageCount: 2,
            words: 610,
            pageWords: [450, 160],
            issues: [
              { code: "cover_letter_page_count", message: "Cover letter renders to 2 pages." },
              { code: "cover_letter_too_long", message: "Cover letter has 610 words." },
            ],
          },
        },
      },
    }, { feature: "cover_letter", notes: "Keep the first client win." });

    assert.equal(result.payload.feature, "cover_letter");
    assert.equal(result.repair.strategy, "collapse");
    assert.match(result.payload.notes, /Tighten the cover letter to one polished page/);
    assert.match(result.payload.notes, /Additional user notes:\nKeep the first client win\./);
  });

  it("rejects unsupported features and artifacts without review issues", () => {
    assert.throws(
      () => buildRepairRequestPayload({
        ...baseManifest,
        quality: { documents: { resume: { status: "pass", issues: [] } } },
      }, { feature: "both" }),
      (err) => err.statusCode === 400 && /feature/.test(err.message),
    );
    assert.throws(
      () => buildRepairRequestPayload({
        ...baseManifest,
        quality: { documents: { resume: { status: "pass", issues: [] } } },
      }, { feature: "resume" }),
      (err) => err.statusCode === 400 && /No review issues/.test(err.message),
    );
  });

  it("rejects repair while a materials request is already pending", () => {
    assert.throws(
      () => buildRepairRequestPayload({
        ...baseManifest,
        pending: { feature: "resume" },
        quality: {
          documents: {
            resume: {
              status: "review",
              issues: [{ code: "resume_second_page_sparse", message: "Second page sparse." }],
            },
          },
        },
      }, { feature: "resume" }),
      (err) => err.statusCode === 409 && /pending/.test(err.message),
    );
  });
});
