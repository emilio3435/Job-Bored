import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { formatDoctorReport, runDoctor } from "../scripts/doctor.mjs";

async function createDoctorRepo() {
  const root = await mkdtemp(join(tmpdir(), "jobbored-doctor-"));
  await mkdir(join(root, "schemas"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "doctor-test",
        engines: { node: ">=24 <25", npm: ">=11 <12" },
      },
      null,
      2,
    ),
  );
  await writeFile(join(root, ".nvmrc"), "24\n");
  await writeFile(join(root, ".node-version"), "24\n");
  await writeFile(
    join(root, "config.js"),
    `window.COMMAND_CENTER_CONFIG = {
      sheetId: "sheet123",
      oauthClientId: "client.apps.googleusercontent.com",
      discoveryWebhookUrl: "http://127.0.0.1:8644/webhook",
      jobPostingScrapeUrl: "https://scraper.example.com"
    };\n`,
  );
  await writeFile(
    join(root, "schemas", "pipeline-row.v1.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        headerRow: ["Date Found", "Title", "Company", "Status"],
        columns: [
          { id: "dateFound", headerLabel: "Date Found", sheetIndex: 0 },
          { id: "title", headerLabel: "Title", sheetIndex: 1 },
          { id: "company", headerLabel: "Company", sheetIndex: 2 },
          {
            id: "status",
            headerLabel: "Status",
            sheetIndex: 3,
            enum: ["New", "Expired"],
          },
        ],
      },
      null,
      2,
    ),
  );
  return root;
}

function spawnSyncImpl(command, args = []) {
  const joined = [command, ...args].join(" ");
  if (joined === "npm -v") return { status: 0, stdout: "11.13.0\n", stderr: "" };
  if (joined === "ngrok --version") return { status: 0, stdout: "ngrok version 3\n", stderr: "" };
  if (joined === "wrangler --version") return { status: 0, stdout: "wrangler 4\n", stderr: "" };
  if (joined === "gcloud --version") return { status: 1, stdout: "", stderr: "" };
  return { status: 1, stdout: "", stderr: "" };
}

describe("doctor CLI", () => {
  it("produces read-only diagnostics with config, CORS, sheet, tool, and port hints", async () => {
    const repoRoot = await createDoctorRepo();
    const report = await runDoctor({
      repoRoot,
      env: {
        JOBBORED_DOCTOR_DASHBOARD_ORIGIN: "https://user.github.io",
        JOBBORED_DOCTOR_GOOGLE_ACCESS_TOKEN: "secret-value",
      },
      spawnSyncImpl,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            values: [["Date Found", "Wrong", "Company", "Status"]],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      checkPortImpl: async (_host, port) => port === 8644,
    });
    const output = formatDoctorReport(report);

    assert.equal(report.ok, true);
    assert.match(output, /JobBored doctor \(read-only\)/);
    assert.match(output, /config\.js found/);
    assert.match(output, /Hosted scraper must include https:\/\/user\.github\.io/);
    assert.match(output, /HTTPS dashboards cannot POST to localhost discovery URLs/);
    assert.match(output, /Pipeline headers differ from schemas\/pipeline-row\.v1\.json/);
    assert.match(output, /discovery worker is listening on 127\.0\.0\.1:8644/);
    assert.doesNotMatch(output, /secret-value/);
  });
});
