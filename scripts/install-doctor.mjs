#!/usr/bin/env node
// Owner: Backend Worker A
// Purpose: One-shot health check for greenfield install. Detects gcloud,
// wrangler, ngrok, and node. Returns the locked install-doctor JSON shape.
//
// Locked contract — see dev-server.mjs handleInstallDoctor header.
//
// Implementation notes:
//   - Use spawnSync with --version flags; ignore non-zero exit codes
//     gracefully (treat as "not installed").
//   - "loggedIn" detection:
//       gcloud:    "gcloud auth list --format=json" -> any active account
//       wrangler:  "wrangler whoami" -> exit 0 means logged in
//       ngrok:     check ~/.config/ngrok/ngrok.yml or
//                  "ngrok config check" exit 0 means token present
//   - "missing" array contains human-readable next steps in priority order.
//   - This file is meant to be runnable standalone (CLI) AND importable as
//     a function for the dev-server handler.

import childProcess from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function firstLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function detectVersion(command, args = ["--version"]) {
  const result = run(command, args);
  const installed = !result.error && result.status === 0;
  const output = firstLine(result.stdout) || firstLine(result.stderr);
  return installed && output ? { installed, version: output } : { installed };
}

function parseJsonArray(raw) {
  try {
    const value = JSON.parse(String(raw || "").trim() || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function hasActiveGcloudAccount(raw) {
  return parseJsonArray(raw).some((account) => {
    if (!account || typeof account !== "object") return false;
    if (account.active === true) return true;
    return String(account.status || "").toUpperCase() === "ACTIVE";
  });
}

function detectGcloud() {
  const version = detectVersion("gcloud", ["--version"]);
  if (!version.installed) {
    return { installed: false, loggedIn: false };
  }
  const auth = run("gcloud", ["auth", "list", "--format=json"]);
  return {
    installed: true,
    loggedIn: auth.status === 0 && hasActiveGcloudAccount(auth.stdout),
    ...(version.version ? { version: version.version } : {}),
  };
}

function detectWrangler() {
  const version = detectVersion("wrangler", ["--version"]);
  if (!version.installed) {
    return { installed: false, loggedIn: false };
  }
  const whoami = run("wrangler", ["whoami"]);
  return {
    installed: true,
    loggedIn: whoami.status === 0,
    ...(version.version ? { version: version.version } : {}),
  };
}

function detectNgrok() {
  const version = detectVersion("ngrok", ["--version"]);
  if (!version.installed) {
    return { installed: false, hasAuthToken: false };
  }
  const config = run("ngrok", ["config", "check"]);
  return {
    installed: true,
    hasAuthToken: config.status === 0,
    ...(version.version ? { version: version.version } : {}),
  };
}

function buildMissing(tools) {
  const missing = [];
  if (!tools.gcloud.installed) {
    missing.push("Install Google Cloud CLI (`gcloud`).");
  } else if (!tools.gcloud.loggedIn) {
    missing.push("Run `gcloud auth login`.");
  }

  if (!tools.wrangler.installed) {
    missing.push("Install Cloudflare Wrangler (`npm install -g wrangler`).");
  } else if (!tools.wrangler.loggedIn) {
    missing.push("Run `wrangler login`.");
  }

  if (!tools.ngrok.installed) {
    missing.push("Install ngrok.");
  } else if (!tools.ngrok.hasAuthToken) {
    missing.push("Run `ngrok config add-authtoken <token>`.");
  }

  if (!tools.node.ok) {
    missing.push("Install a working Node.js runtime.");
  }

  return missing;
}

export function runInstallDoctor() {
  const tools = {
    gcloud: detectGcloud(),
    wrangler: detectWrangler(),
    ngrok: detectNgrok(),
    node: { version: process.version, ok: Boolean(process.version) },
  };
  const missing = buildMissing(tools);
  return {
    ok: missing.length === 0,
    tools,
    missing,
  };
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCliEntrypoint()) {
  process.stdout.write(`${JSON.stringify(runInstallDoctor())}\n`);
}
