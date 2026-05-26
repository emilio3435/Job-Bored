import assert from "node:assert/strict";
import test from "node:test";

import { PIPELINE_HEADER_ROW } from "../../src/contracts.ts";
import {
  checkJobPostingUrl,
  classifyJobPostingAvailability,
  runExpiredJobCleanup,
} from "../../src/cleanup/expired-job-cleanup.ts";

const runtimeConfig = {
  googleAccessToken: "test-access-token",
  googleServiceAccountJson: "",
  googleServiceAccountFile: "",
  googleOAuthTokenJson: "",
  googleOAuthTokenFile: "",
};

function row(values: string[]) {
  return Array.from(
    { length: PIPELINE_HEADER_ROW.length },
    (_, index) => values[index] || "",
  );
}

function columnIndexToLetter(index: number) {
  let n = Math.floor(index);
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
}

const LAST_COLUMN_LETTER = columnIndexToLetter(PIPELINE_HEADER_ROW.length);

function responseJson(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function responseText(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
}

function createCleanupFetch(dataRows: string[][], jobResponses: Record<string, Response>) {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = String(init.method || "GET").toUpperCase();
    calls.push({
      url: url.toString(),
      method,
      body: init.body ? String(init.body) : "",
    });

    if (
      url.hostname === "sheets.googleapis.com" &&
      method === "GET" &&
      url.href.includes(`A1%3A${LAST_COLUMN_LETTER}1`)
    ) {
      return responseJson({ values: [PIPELINE_HEADER_ROW] });
    }
    if (
      url.hostname === "sheets.googleapis.com" &&
      method === "GET" &&
      url.href.includes(`A2%3A${LAST_COLUMN_LETTER}`)
    ) {
      return responseJson({ values: dataRows });
    }
    if (url.hostname === "sheets.googleapis.com" && method === "POST") {
      return responseJson({ updatedRows: 1 });
    }

    const response = jobResponses[url.toString()];
    if (response) return response;
    return responseText("Apply now", 200);
  };
  return { fetchImpl, calls };
}

test("classifyJobPostingAvailability only expires strong closed evidence", () => {
  assert.equal(
    classifyJobPostingAvailability({
      url: "https://jobs.example.com/closed",
      httpStatus: 404,
      body: "",
    }).status,
    "expired",
  );
  assert.equal(
    classifyJobPostingAvailability({
      url: "https://jobs.example.com/blocked",
      httpStatus: 403,
      body: "Forbidden",
    }).status,
    "unknown",
  );
  assert.equal(
    classifyJobPostingAvailability({
      url: "https://jobs.example.com/rate-limited",
      httpStatus: 429,
      body: "Too many requests",
    }).status,
    "unknown",
  );
  assert.equal(
    classifyJobPostingAvailability({
      url: "https://jobs.example.com/closed",
      httpStatus: 200,
      body: "<h1>This job posting has expired</h1>",
    }).status,
    "expired",
  );
  assert.equal(
    classifyJobPostingAvailability({
      url: "https://jobs.smartrecruiters.com/example/123",
      httpStatus: 200,
      body: "This job has expired Sorry, this job is no longer available.",
    }).status,
    "expired",
  );
  assert.equal(
    classifyJobPostingAvailability({
      url: "https://jobs.example.com/captcha",
      httpStatus: 200,
      body: "Verify you are human before continuing",
    }).status,
    "unknown",
  );
  assert.equal(
    classifyJobPostingAvailability({
      url: "https://jobs.example.com/open",
      httpStatus: 200,
      body: "<button>Apply now</button>",
    }).status,
    "open",
  );
  assert.equal(
    classifyJobPostingAvailability({
      url: "https://jobs.example.com/ambiguous",
      httpStatus: 200,
      body: "Welcome to our careers site",
    }).status,
    "unknown",
  );
});

test("checkJobPostingUrl reports network failures as temporarily unreachable", async () => {
  const result = await checkJobPostingUrl("https://jobs.example.com/down", {
    fetchImpl: (async () => {
      throw new Error("ECONNRESET");
    }) as any,
  });

  assert.equal(result.status, "temporarily_unreachable");
  assert.equal(result.source, "network_error");
});

test("checkJobPostingUrl reports timeouts as temporarily unreachable", async () => {
  const result = await checkJobPostingUrl("https://jobs.example.com/slow", {
    timeoutMs: 1,
    fetchImpl: (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      await new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
      return responseText("Apply now", 200);
    }) as any,
  });

  assert.equal(result.status, "temporarily_unreachable");
  assert.equal(result.source, "timeout");
});

test("runExpiredJobCleanup dry-run reports changes without writing protected statuses", async () => {
  const rows = [
    row([
      "2026-05-01",
      "Closed Role",
      "Acme",
      "Remote",
      "https://jobs.example.com/closed",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "New",
    ]),
    row([
      "2026-05-01",
      "Applied Role",
      "Acme",
      "Remote",
      "https://jobs.example.com/applied-closed",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Applied",
    ]),
    row([
      "2026-05-01",
      "Blocked Role",
      "Acme",
      "Remote",
      "https://jobs.example.com/blocked",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Researching",
    ]),
  ];
  const { fetchImpl, calls } = createCleanupFetch(rows, {
    "https://jobs.example.com/closed": responseText("This job is no longer accepting applications", 200),
    "https://jobs.example.com/blocked": responseText("Forbidden", 403),
  });

  const result = await runExpiredJobCleanup({
    sheetId: "sheet_123",
    runtimeConfig: runtimeConfig as any,
    options: {
      dryRun: true,
      fetchImpl: fetchImpl as any,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    },
  });

  assert.equal(result.checked, 2);
  assert.equal(result.wouldUpdate, 1);
  assert.equal(result.wouldExpire, 1);
  assert.equal(result.needsReview, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.results[0].action, "would_expire");
  assert.equal(result.results[1].reason, "protected_status");
  assert.equal(
    calls.some((call) => call.method === "POST"),
    false,
    "dry-run must not write to Sheets",
  );
  assert.equal(
    calls.some((call) => call.url === "https://jobs.example.com/applied-closed"),
    false,
    "protected Applied rows should not be fetched or expired",
  );
});

test("runExpiredJobCleanup skips every protected status without fetching postings", async () => {
  const protectedStatuses = [
    "Applied",
    "Phone Screen",
    "Interviewing",
    "Offer",
    "Rejected",
    "Passed",
    "Expired",
  ];
  const rows = protectedStatuses.map((status, index) =>
    row([
      "2026-05-01",
      `${status} Role`,
      "Acme",
      "Remote",
      `https://jobs.example.com/protected-${index}`,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      status,
    ]),
  );
  const { fetchImpl, calls } = createCleanupFetch(rows, {});

  const result = await runExpiredJobCleanup({
    sheetId: "sheet_123",
    runtimeConfig: runtimeConfig as any,
    options: {
      dryRun: true,
      fetchImpl: fetchImpl as any,
    },
  });

  assert.equal(result.checked, 0);
  assert.equal(result.skipped, protectedStatuses.length);
  assert.equal(result.results.every((entry) => entry.reason === "protected_status"), true);
  assert.equal(
    calls.some((call) => call.url.startsWith("https://jobs.example.com/protected-")),
    false,
    "protected rows should not be fetched",
  );
});

test("runExpiredJobCleanup writes Status and Notes audit for confirmed expired rows", async () => {
  const rows = [
    row([
      "2026-05-01",
      "Closed Role",
      "Acme",
      "Remote",
      "https://jobs.example.com/closed",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Researching",
      "",
      "Existing note",
    ]),
  ];
  const { fetchImpl, calls } = createCleanupFetch(rows, {
    "https://jobs.example.com/closed": responseText("Gone", 410),
  });

  const result = await runExpiredJobCleanup({
    sheetId: "sheet_123",
    runtimeConfig: runtimeConfig as any,
    options: {
      dryRun: false,
      fetchImpl: fetchImpl as any,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    },
  });

  assert.equal(result.updated, 1);
  const post = calls.find((call) => call.method === "POST");
  assert.ok(post, "write mode should batch-update Sheets");
  const body = JSON.parse(post.body);
  assert.deepEqual(body.data[0], {
    range: "Pipeline!M2",
    majorDimension: "ROWS",
    values: [["Expired"]],
  });
  assert.equal(body.data[1].range, "Pipeline!O2");
  assert.match(body.data[1].values[0][0], /^Existing note\n\[Expired cleanup 2026-05-20T12:00:00.000Z\]/);
  assert.match(body.data[1].values[0][0], /Status: Researching -> Expired/);
  assert.match(body.data[1].values[0][0], /source=http_status/);
  assert.match(body.data[1].values[0][0], /confidence=high/);
});

test("runExpiredJobCleanup write mode tags needs-review rows with a Notes audit so the dashboard review modal surfaces them", async () => {
  const rows = [
    row([
      "2026-05-01",
      "Captcha Role",
      "Acme",
      "Remote",
      "https://jobs.example.com/captcha",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "New",
      "",
      "",
    ]),
    row([
      "2026-05-01",
      "Already Flagged",
      "Acme",
      "Remote",
      "https://jobs.example.com/blocked",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Researching",
      "",
      "[Expired cleanup 2026-05-01T00:00:00.000Z] Availability review: checkedUrl=\"https://jobs.example.com/blocked\"; source=http_status; confidence=none; reason=\"HTTP 403 requires review\"",
    ]),
  ];
  const { fetchImpl, calls } = createCleanupFetch(rows, {
    "https://jobs.example.com/captcha": responseText(
      "Verify you are human before continuing",
      200,
    ),
    "https://jobs.example.com/blocked": responseText("Forbidden", 403),
  });

  const result = await runExpiredJobCleanup({
    sheetId: "sheet_123",
    runtimeConfig: runtimeConfig as any,
    options: {
      dryRun: false,
      fetchImpl: fetchImpl as any,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    },
  });

  assert.equal(result.needsReview, 2);
  assert.equal(result.updated, 0);
  const post = calls.find((call) => call.method === "POST");
  assert.ok(post, "needs-review rows without a prior audit must be tagged with a Notes line");
  const body = JSON.parse(post.body);
  assert.equal(body.data.length, 1, "only the un-tagged needs-review row should be updated");
  assert.equal(body.data[0].range, "Pipeline!O2");
  assert.match(body.data[0].values[0][0], /Availability review:/);
  assert.match(body.data[0].values[0][0], /source=captcha_marker/);
});

test("runExpiredJobCleanup dry-run does not write needs-review audit notes", async () => {
  const rows = [
    row([
      "2026-05-01",
      "Captcha Role",
      "Acme",
      "Remote",
      "https://jobs.example.com/captcha",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "New",
      "",
      "",
    ]),
  ];
  const { fetchImpl, calls } = createCleanupFetch(rows, {
    "https://jobs.example.com/captcha": responseText(
      "Verify you are human before continuing",
      200,
    ),
  });

  const result = await runExpiredJobCleanup({
    sheetId: "sheet_123",
    runtimeConfig: runtimeConfig as any,
    options: {
      dryRun: true,
      fetchImpl: fetchImpl as any,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    },
  });

  assert.equal(result.needsReview, 1);
  assert.equal(result.wouldUpdate, 0);
  assert.equal(
    calls.some((call) => call.method === "POST"),
    false,
    "dry-run must not write to Sheets",
  );
});
