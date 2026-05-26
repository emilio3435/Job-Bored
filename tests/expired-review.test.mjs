import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

import { repoRoot } from "../scripts/lib/schedule.mjs";

function loadReviewApi() {
  const source = readFileSync(join(repoRoot, "expired-review.js"), "utf8");
  const context = { window: {}, globalThis: {} };
  vm.runInNewContext(source, context, { filename: "expired-review.js" });
  return context.window.JobBoredExpiredReview;
}

test("expired review queue includes only active linked postings that need review", () => {
  const api = loadReviewApi();
  const now = new Date("2026-05-25T12:00:00.000Z");
  const rows = [
    {
      title: "Old New Role",
      company: "Acme",
      status: "New",
      link: "https://jobs.example.com/old",
      dateFound: new Date("2026-04-10T12:00:00.000Z"),
    },
    {
      title: "Recent Role",
      company: "Acme",
      status: "Researching",
      link: "https://jobs.example.com/recent",
      dateFound: new Date("2026-05-20T12:00:00.000Z"),
    },
    {
      title: "Applied Role",
      company: "Acme",
      status: "Applied",
      link: "https://jobs.example.com/applied",
      dateFound: new Date("2026-04-01T12:00:00.000Z"),
    },
    {
      title: "Missing Link",
      company: "Acme",
      status: "New",
      link: "",
      dateFound: new Date("2026-04-01T12:00:00.000Z"),
    },
  ];

  const review = api.getReviewJobs(rows, { now, staleDays: 30 });

  assert.equal(review.length, 1);
  assert.equal(review[0].index, 0);
  assert.equal(review[0].reason.kind, "stale-active");
});

test("expired review queue treats cleanup review notes as immediate review items", () => {
  const api = loadReviewApi();
  const review = api.getReviewJobs(
    [
      {
        title: "Blocked Role",
        company: "Acme",
        status: "Researching",
        link: "https://jobs.example.com/blocked",
        _rawNotes: "Availability review: HTTP 403 requires manual check",
        dateFound: new Date("2026-05-24T12:00:00.000Z"),
      },
    ],
    { now: new Date("2026-05-25T12:00:00.000Z"), staleDays: 30 },
  );

  assert.equal(review.length, 1);
  assert.equal(review[0].reason.kind, "cleanup-note");
});

test("expired review UI is a single navbar action with one modal surface", () => {
  const index = readFileSync(join(repoRoot, "index.html"), "utf8");
  const chrome = readFileSync(join(repoRoot, "flowing-chrome.js"), "utf8");

  assert.match(index, /id="expiredReviewBtn"/);
  assert.match(index, /id="expiredReviewModal"/);
  assert.match(chrome, /expiredReviewBtn/);
  assert.equal((index.match(/id="expiredReviewModal"/g) || []).length, 1);
});

test("expired review modal renders every needs-review row with a direct posting link", () => {
  const api = loadReviewApi();
  const rows = [
    {
      title: "Captcha Role",
      company: "Acme",
      status: "New",
      link: "https://jobs.example.com/captcha",
      _rawNotes: "Availability review: captcha blocked",
      dateFound: new Date("2026-05-20T12:00:00.000Z"),
    },
    {
      title: "Forbidden Role",
      company: "Acme",
      status: "Researching",
      link: "https://jobs.example.com/forbidden",
      _rawNotes: "Availability review: HTTP 403 requires manual check",
      dateFound: new Date("2026-05-21T12:00:00.000Z"),
    },
    {
      title: "Timeout Role",
      company: "Acme",
      status: "New",
      link: "https://jobs.example.com/timeout",
      _rawNotes: "Availability review: timeout after 15000ms",
      dateFound: new Date("2026-05-22T12:00:00.000Z"),
    },
  ];

  const review = api.getReviewJobs(rows, {
    now: new Date("2026-05-25T12:00:00.000Z"),
    staleDays: 30,
  });

  assert.equal(review.length, rows.length);
  for (const entry of review) {
    assert.match(entry.job.link, /^https?:\/\//);
    assert.equal(entry.reason.kind, "cleanup-note");
  }
});
