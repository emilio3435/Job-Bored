#!/usr/bin/env node
// Owner: Backend Worker A
// Purpose: Auto-create a Google OAuth Client ID for the dashboard via the
// gcloud CLI on the user's own Google project. Free for the user; $0 to the
// maintainer.
//
// Locked contract — see dev-server.mjs handleOAuthBootstrap header.
//
// Implementation notes for the worker:
//   - Detect gcloud via spawnSync("gcloud","--version").
//   - Check auth via "gcloud auth list --format=json".
//   - Required APIs: iam.googleapis.com, oauth2.googleapis.com.
//   - Use "gcloud iap oauth-clients create" or the OAuth brand+client APIs.
//   - Never run "gcloud auth login" non-interactively. Return
//     { ok:false, reason:"not_logged_in" } and let the user run it themselves.
//   - Output must be valid JSON to stdout for the dev-server handler.
//   - Localhost / dev-server gating happens at the HTTP layer, not here.

import childProcess from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_ORIGINS = ["http://localhost:8080", "http://127.0.0.1:8080"];
const REQUIRED_APIS = ["iam.googleapis.com", "oauth2.googleapis.com"];
const API_DISABLED_ACTION =
  "Run `gcloud services enable iam.googleapis.com oauth2.googleapis.com`";
const DEFAULT_APPLICATION_NAME = "JobBored local dashboard";

function failure(reason, actionable) {
  return { ok: false, reason, actionable };
}

function run(command, args) {
  try {
    return childProcess.spawnSync(command, args, {
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
      windowsHide: true,
    });
  } catch (error) {
    return { status: 1, stdout: "", stderr: "", error };
  }
}

function resultText(result) {
  return [
    result && result.stdout ? String(result.stdout) : "",
    result && result.stderr ? String(result.stderr) : "",
    result && result.error && result.error.message ? String(result.error.message) : "",
  ].join("\n");
}

function hasAccessNotConfigured(result) {
  return /accessNotConfigured|SERVICE_DISABLED|API has not been used/i.test(resultText(result));
}

function parseJson(raw, fallback = null) {
  try {
    return JSON.parse(String(raw || "").trim());
  } catch {
    return fallback;
  }
}

function isActiveAccount(account) {
  if (!account || typeof account !== "object") return false;
  if (account.active === true) return true;
  return String(account.status || "").toUpperCase() === "ACTIVE";
}

function activeAccountFromAuthList(raw) {
  const accounts = parseJson(raw, []);
  if (!Array.isArray(accounts)) return "";
  const active = accounts.find(isActiveAccount);
  return active && active.account ? String(active.account) : "";
}

function normalizeProjectId(value) {
  return String(value || "").trim();
}

function normalizeApplicationName(value) {
  const trimmed = String(value || "").trim() || DEFAULT_APPLICATION_NAME;
  return trimmed.slice(0, 32);
}

function resolveProjectId(explicitProjectId) {
  const projectId = normalizeProjectId(explicitProjectId);
  if (projectId) return projectId;
  const config = run("gcloud", ["config", "get-value", "project"]);
  if (config.status !== 0) return "";
  const value = String(config.stdout || "").trim();
  return value && value !== "(unset)" ? value : "";
}

function enabledServiceName(service) {
  if (!service || typeof service !== "object") return "";
  if (typeof service.name === "string") return service.name;
  if (service.config && typeof service.config.name === "string") return service.config.name;
  return "";
}

function verifyRequiredApis(projectId) {
  const result = run("gcloud", [
    "services",
    "list",
    "--enabled",
    "--format=json",
    `--project=${projectId}`,
  ]);
  if (hasAccessNotConfigured(result)) {
    return failure("api_disabled", API_DISABLED_ACTION);
  }
  if (result.status !== 0) {
    return failure("internal_error", "Could not verify Google Cloud APIs. Check `gcloud services list`.");
  }
  const services = parseJson(result.stdout, []);
  const enabled = new Set(Array.isArray(services) ? services.map(enabledServiceName) : []);
  const missing = REQUIRED_APIS.filter((api) => !enabled.has(api));
  if (missing.length) {
    return failure("api_disabled", API_DISABLED_ACTION);
  }
  return { ok: true };
}

function oauthClientIdFromResponse(payload, fallbackId) {
  if (!payload || typeof payload !== "object") return fallbackId;
  if (typeof payload.clientId === "string" && payload.clientId.trim()) {
    return payload.clientId.trim();
  }
  if (typeof payload.oauthClientId === "string" && payload.oauthClientId.trim()) {
    return payload.oauthClientId.trim();
  }
  if (typeof payload.name === "string" && payload.name.trim()) {
    return payload.name.trim().split("/").pop() || fallbackId;
  }
  return fallbackId;
}

function clientSecretFromResponse(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.clientSecret === "string") return payload.clientSecret.trim();
  if (typeof payload.secret === "string") return payload.secret.trim();
  return "";
}

function createOAuthClient({ projectId, applicationName }) {
  const clientResourceId = `jobbored-local-${Date.now().toString(36)}`;
  const displayName = normalizeApplicationName(applicationName);
  const create = run("gcloud", [
    "iam",
    "oauth-clients",
    "create",
    clientResourceId,
    "--location=global",
    "--client-type=public-client",
    `--display-name=${displayName}`,
    "--description=JobBored local dashboard OAuth client",
    "--allowed-grant-types=authorization-code-grant",
    `--allowed-redirect-uris=${LOCAL_ORIGINS.join(",")}`,
    "--allowed-scopes=openid,email,https://www.googleapis.com/auth/cloud-platform",
    `--project=${projectId}`,
    "--format=json",
  ]);
  if (hasAccessNotConfigured(create)) {
    return failure("api_disabled", API_DISABLED_ACTION);
  }
  if (create.status !== 0) {
    return failure(
      "internal_error",
      "Could not create the OAuth client with gcloud. Check your Google Cloud project permissions.",
    );
  }

  const payload = parseJson(create.stdout, {});
  const clientId = oauthClientIdFromResponse(payload, clientResourceId);
  const clientSecret = clientSecretFromResponse(payload);
  return {
    ok: true,
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    source: "gcloud",
  };
}

export function runOAuthBootstrap(options = {}) {
  try {
    const version = run("gcloud", ["--version"]);
    if (version.error || version.status !== 0) {
      return failure("gcloud_missing", "Install Google Cloud CLI (`gcloud`) then click again");
    }

    const auth = run("gcloud", ["auth", "list", "--format=json"]);
    if (hasAccessNotConfigured(auth)) {
      return failure("api_disabled", API_DISABLED_ACTION);
    }
    if (auth.status !== 0 || !activeAccountFromAuthList(auth.stdout)) {
      return failure("not_logged_in", "Run `gcloud auth login` then click again");
    }

    const projectId = resolveProjectId(options.projectId);
    if (!projectId) {
      return failure(
        "internal_error",
        "Set a Google Cloud project with `gcloud config set project PROJECT_ID` then click again",
      );
    }

    const apiCheck = verifyRequiredApis(projectId);
    if (!apiCheck.ok) return apiCheck;

    return createOAuthClient({
      projectId,
      applicationName: options.applicationName,
    });
  } catch {
    return failure("internal_error", "OAuth bootstrap failed. Check the terminal and try again.");
  }
}

function cliOptions(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project-id" || arg === "--project") {
      options.projectId = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--project-id=")) {
      options.projectId = arg.slice("--project-id=".length);
    } else if (arg.startsWith("--project=")) {
      options.projectId = arg.slice("--project=".length);
    } else if (arg === "--application-name") {
      options.applicationName = argv[i + 1] || "";
      i += 1;
    } else if (arg.startsWith("--application-name=")) {
      options.applicationName = arg.slice("--application-name=".length);
    }
  }
  return options;
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCliEntrypoint()) {
  process.stdout.write(`${JSON.stringify(runOAuthBootstrap(cliOptions(process.argv.slice(2))))}\n`);
}
