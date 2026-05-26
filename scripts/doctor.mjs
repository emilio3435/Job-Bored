#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import { join, resolve } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REQUIRED_NODE_MAJOR = 24;
const PIPELINE_SCHEMA_PATH = "schemas/pipeline-row.v1.json";
const CONFIG_PATH = "config.js";
const CONFIG_EXAMPLE_PATH = "config.example.js";

function firstLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function check(level, name, message, details = {}) {
  return { level, name, message, details };
}

function summarize(checks) {
  return {
    fail: checks.filter((item) => item.level === "fail").length,
    warn: checks.filter((item) => item.level === "warn").length,
    ok: checks.filter((item) => item.level === "ok").length,
    skip: checks.filter((item) => item.level === "skip").length,
    info: checks.filter((item) => item.level === "info").length,
  };
}

function parseNodeMajor(version) {
  const match = /^v?(\d+)\./.exec(String(version || ""));
  return match ? Number(match[1]) : NaN;
}

function runCommand(spawnSyncImpl, command, args = []) {
  try {
    return spawnSyncImpl(command, args, {
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
      windowsHide: true,
    });
  } catch (error) {
    return { status: 1, stdout: "", stderr: "", error };
  }
}

function detectTool(spawnSyncImpl, command, args = ["--version"]) {
  const result = runCommand(spawnSyncImpl, command, args);
  if (result.error || result.status !== 0) {
    return { installed: false };
  }
  return {
    installed: true,
    version: firstLine(result.stdout) || firstLine(result.stderr),
  };
}

async function readJson(repoRoot, relativePath) {
  const raw = await readFile(join(repoRoot, relativePath), "utf8");
  return JSON.parse(raw);
}

async function readTextIfExists(repoRoot, relativePath) {
  const path = join(repoRoot, relativePath);
  if (!existsSync(path)) return "";
  return readFile(path, "utf8");
}

function readConfigObject(source) {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { timeout: 500 });
  const config = sandbox.window && sandbox.window.COMMAND_CENTER_CONFIG;
  return config && typeof config === "object" ? config : {};
}

async function loadConfig(repoRoot) {
  const configPath = join(repoRoot, CONFIG_PATH);
  const path = existsSync(configPath) ? CONFIG_PATH : CONFIG_EXAMPLE_PATH;
  const source = await readTextIfExists(repoRoot, path);
  if (!source) return { path, exists: false, config: {} };
  try {
    return { path, exists: path === CONFIG_PATH, config: readConfigObject(source) };
  } catch (error) {
    return {
      path,
      exists: path === CONFIG_PATH,
      config: {},
      error: error && error.message ? error.message : String(error),
    };
  }
}

function normalizeSheetId(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const match = /\/spreadsheets\/d\/([^/?#]+)/.exec(value);
  return match ? match[1] : value;
}

function normalizeOrigin(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.origin;
  } catch (_) {
    return "";
  }
}

function isLocalUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch (_) {
    return false;
  }
}

function isHttpsUrl(raw) {
  try {
    return new URL(String(raw || "")).protocol === "https:";
  } catch (_) {
    return false;
  }
}

function headersMatch(actual, expected) {
  if (!Array.isArray(actual) || actual.length < expected.length) return false;
  return expected.every(
    (header, index) =>
      String(actual[index] || "").trim().toLowerCase() ===
      String(header).trim().toLowerCase(),
  );
}

async function fetchSheetHeaders({ sheetId, token, fetchImpl }) {
  const url =
    "https://sheets.googleapis.com/v4/spreadsheets/" +
    encodeURIComponent(sheetId) +
    "/values/Pipeline!A1:T1";
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  const body = await response.json().catch(() => ({}));
  const values = Array.isArray(body.values) && Array.isArray(body.values[0])
    ? body.values[0]
    : [];
  return { ok: true, headers: values.map((value) => String(value || "").trim()) };
}

function defaultCheckPort(host, port, timeoutMs = 250) {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host, port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePort(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function collectPortChecks(checkPortImpl) {
  const ports = [
    ["dashboard", "127.0.0.1", 8080],
    ["scraper", "127.0.0.1", 3847],
    ["discovery worker", "127.0.0.1", 8644],
    ["ngrok API", "127.0.0.1", 4040],
  ];
  const checks = [];
  for (const [name, host, port] of ports) {
    const open = await checkPortImpl(host, port);
    checks.push(
      check(
        open ? "ok" : "info",
        `port:${port}`,
        open ? `${name} is listening on ${host}:${port}` : `${name} is not listening on ${host}:${port}`,
        { host, port, open },
      ),
    );
  }
  return checks;
}

async function runDoctor(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const env = options.env || process.env;
  const spawnSyncImpl = options.spawnSyncImpl || spawnSync;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const checkPortImpl = options.checkPortImpl || defaultCheckPort;
  const checks = [];

  const nodeMajor = parseNodeMajor(process.version);
  checks.push(
    check(
      nodeMajor === REQUIRED_NODE_MAJOR ? "ok" : "fail",
      "node",
      `Node ${process.version}; required >=24 <25 for direct TypeScript strip-types support.`,
      { version: process.version, required: ">=24 <25" },
    ),
  );

  const npm = detectTool(spawnSyncImpl, "npm", ["-v"]);
  checks.push(
    check(
      npm.installed ? "ok" : "fail",
      "npm",
      npm.installed ? `npm ${npm.version || "installed"}` : "npm is not available on PATH.",
      npm,
    ),
  );

  const pkg = await readJson(repoRoot, "package.json");
  checks.push(
    check(
      pkg.engines && pkg.engines.node === ">=24 <25" ? "ok" : "warn",
      "package engines",
      `package.json engines.node is ${pkg.engines && pkg.engines.node ? pkg.engines.node : "missing"}.`,
    ),
  );

  const [nvmrc, nodeVersion] = await Promise.all([
    readTextIfExists(repoRoot, ".nvmrc"),
    readTextIfExists(repoRoot, ".node-version"),
  ]);
  checks.push(
    check(
      nvmrc.trim() === "24" && nodeVersion.trim() === "24" ? "ok" : "warn",
      "node version files",
      `.nvmrc=${nvmrc.trim() || "missing"} .node-version=${nodeVersion.trim() || "missing"}.`,
    ),
  );

  const config = await loadConfig(repoRoot);
  if (config.error) {
    checks.push(check("fail", "config.js", `Could not parse ${config.path}: ${config.error}`));
  } else if (config.exists) {
    checks.push(check("ok", "config.js", "config.js found."));
  } else {
    checks.push(check("warn", "config.js", "config.js missing; using config.example.js placeholders."));
  }

  const cfg = config.config || {};
  const sheetId = normalizeSheetId(cfg.sheetId);
  checks.push(
    check(
      sheetId && sheetId !== "YOUR_SHEET_ID_HERE" ? "ok" : "warn",
      "sheet id",
      sheetId && sheetId !== "YOUR_SHEET_ID_HERE" ? "Sheet ID is configured." : "Sheet ID is not configured.",
    ),
  );
  checks.push(
    check(
      cfg.oauthClientId && !String(cfg.oauthClientId).includes("YOUR_CLIENT_ID")
        ? "ok"
        : "warn",
      "oauth client",
      cfg.oauthClientId && !String(cfg.oauthClientId).includes("YOUR_CLIENT_ID")
        ? "OAuth Client ID is configured."
        : "OAuth Client ID is not configured.",
    ),
  );

  const dashboardOrigin = normalizeOrigin(env.JOBBORED_DOCTOR_DASHBOARD_ORIGIN);
  if (dashboardOrigin) {
    checks.push(
      check(
        "info",
        "oauth origin",
        `Verify ${dashboardOrigin} is in Google OAuth Authorized JavaScript origins.`,
        { origin: dashboardOrigin },
      ),
    );
  }

  if (cfg.jobPostingScrapeUrl) {
    checks.push(
      check(
        isHttpsUrl(cfg.jobPostingScrapeUrl) || isLocalUrl(cfg.jobPostingScrapeUrl)
          ? "ok"
          : "warn",
        "scraper url",
        `Job posting scraper URL is ${cfg.jobPostingScrapeUrl}.`,
      ),
    );
    if (isHttpsUrl(cfg.jobPostingScrapeUrl) && dashboardOrigin) {
      checks.push(
        check(
          "info",
          "scraper cors",
          `Hosted scraper must include ${dashboardOrigin} in COMMAND_CENTER_ALLOWED_ORIGINS or equivalent.`,
        ),
      );
    }
  } else {
    checks.push(
      check(
        "info",
        "scraper url",
        "Job posting scraper URL is empty; localhost uses http://127.0.0.1:3847, static HTTPS hosts need a deployed scraper.",
      ),
    );
  }

  if (cfg.discoveryWebhookUrl) {
    const webhookIsLocal = isLocalUrl(cfg.discoveryWebhookUrl);
    checks.push(
      check(
        webhookIsLocal && dashboardOrigin && dashboardOrigin.startsWith("https:")
          ? "warn"
          : "ok",
        "discovery webhook",
        webhookIsLocal && dashboardOrigin && dashboardOrigin.startsWith("https:")
          ? "HTTPS dashboards cannot POST to localhost discovery URLs; use a relay or hosted worker."
          : `Discovery webhook URL is ${cfg.discoveryWebhookUrl}.`,
      ),
    );
  } else {
    checks.push(
      check(
        "info",
        "discovery webhook",
        "Discovery webhook URL is empty; manual Pipeline use and scheduled writers still work.",
      ),
    );
  }

  const schema = await readJson(repoRoot, PIPELINE_SCHEMA_PATH);
  const expectedHeaders = Array.isArray(schema.headerRow) ? schema.headerRow : [];
  const statusColumn = Array.isArray(schema.columns)
    ? schema.columns.find((column) => column && column.id === "status")
    : null;
  checks.push(
    check(
      expectedHeaders.length ? "ok" : "fail",
      "pipeline schema",
      `Pipeline schema has ${expectedHeaders.length} headers; statuses: ${
        statusColumn && Array.isArray(statusColumn.enum)
          ? statusColumn.enum.join(", ")
          : "missing"
      }.`,
    ),
  );

  const sheetToken = env.JOBBORED_DOCTOR_GOOGLE_ACCESS_TOKEN || env.GOOGLE_ACCESS_TOKEN || "";
  if (!sheetId || sheetId === "YOUR_SHEET_ID_HERE") {
    checks.push(check("skip", "sheet headers", "Skipped: no Sheet ID configured."));
  } else if (!sheetToken || typeof fetchImpl !== "function") {
    checks.push(
      check(
        "skip",
        "sheet headers",
        "Skipped: provide JOBBORED_DOCTOR_GOOGLE_ACCESS_TOKEN for a read-only Pipeline header check.",
      ),
    );
  } else {
    const headerResult = await fetchSheetHeaders({
      sheetId,
      token: sheetToken,
      fetchImpl,
    }).catch((error) => ({
      ok: false,
      error: error && error.message ? error.message : String(error),
    }));
    if (headerResult.ok) {
      checks.push(
        check(
          headersMatch(headerResult.headers, expectedHeaders) ? "ok" : "warn",
          "sheet headers",
          headersMatch(headerResult.headers, expectedHeaders)
            ? "Pipeline headers match schemas/pipeline-row.v1.json."
            : "Pipeline headers differ from schemas/pipeline-row.v1.json.",
          { checkedColumns: expectedHeaders.length },
        ),
      );
    } else {
      checks.push(
        check(
          "warn",
          "sheet headers",
          `Could not read Pipeline headers${headerResult.status ? ` (HTTP ${headerResult.status})` : ""}.`,
        ),
      );
    }
  }

  for (const toolName of ["ngrok", "wrangler", "gcloud"]) {
    const tool = detectTool(spawnSyncImpl, toolName, ["--version"]);
    checks.push(
      check(
        tool.installed ? "ok" : "info",
        toolName,
        tool.installed ? `${toolName} ${tool.version || "installed"}` : `${toolName} is not installed or not on PATH.`,
        tool,
      ),
    );
  }

  const bootstrapState = await readTextIfExists(repoRoot, "discovery-local-bootstrap.json");
  if (bootstrapState) {
    try {
      const parsed = JSON.parse(bootstrapState);
      checks.push(
        check(
          "info",
          "relay target",
          `Local bootstrap state found${parsed.workerName ? ` for Worker ${parsed.workerName}` : ""}.`,
          {
            localPort: parsed.localPort || "",
            hasLocalWebhookUrl: Boolean(parsed.localWebhookUrl),
          },
        ),
      );
    } catch (_) {
      checks.push(check("warn", "relay target", "discovery-local-bootstrap.json exists but is not valid JSON."));
    }
  } else {
    checks.push(
      check(
        "info",
        "relay target",
        "No discovery-local-bootstrap.json found; run npm run discovery:bootstrap-local for the local relay flow.",
      ),
    );
  }

  checks.push(...(await collectPortChecks(checkPortImpl)));

  return {
    ok: checks.every((item) => item.level !== "fail"),
    checks,
    summary: summarize(checks),
  };
}

function formatDoctorReport(report) {
  const lines = ["JobBored doctor (read-only)"];
  for (const item of report.checks) {
    lines.push(`[${item.level}] ${item.name}: ${item.message}`);
  }
  lines.push(
    `Summary: ${report.summary.fail} fail, ${report.summary.warn} warn, ${report.summary.ok} ok, ${report.summary.skip} skipped.`,
  );
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const report = await runDoctor();
    process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.error(`[doctor] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
}

export { formatDoctorReport, runDoctor };
