import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { afterEach, describe, it, mock } from "node:test";

import { runInstallDoctor } from "../scripts/install-doctor.mjs";

function ok(stdout = "", stderr = "") {
  return { status: 0, stdout, stderr };
}

function failed(stderr = "", status = 1) {
  return { status, stdout: "", stderr };
}

function missingCommand(command) {
  const error = new Error(`spawnSync ${command} ENOENT`);
  error.code = "ENOENT";
  return { status: null, stdout: "", stderr: "", error };
}

function mockSpawnSync(handler) {
  mock.method(childProcess, "spawnSync", handler);
}

afterEach(() => {
  mock.restoreAll();
});

describe("install doctor", () => {
  it("reports all missing tools in priority order", () => {
    mockSpawnSync((command) => missingCommand(command));

    const result = runInstallDoctor();

    assert.deepEqual(result, {
      ok: false,
      tools: {
        gcloud: { installed: false, loggedIn: false },
        wrangler: { installed: false, loggedIn: false },
        ngrok: { installed: false, hasAuthToken: false },
        node: { version: process.version, ok: true },
      },
      missing: [
        "Install Google Cloud CLI (`gcloud`).",
        "Install Cloudflare Wrangler (`npm install -g wrangler`).",
        "Install ngrok.",
      ],
    });
  });

  it("reports all tools ready when installed and authenticated", () => {
    mockSpawnSync((command, args = []) => {
      const joined = [command, ...args].join(" ");
      if (joined === "gcloud --version") return ok("Google Cloud SDK 999.0.0\n");
      if (joined === "gcloud auth list --format=json") {
        return ok('[{"account":"user@example.com","status":"ACTIVE"}]');
      }
      if (joined === "wrangler --version") return ok("wrangler 4.0.0\n");
      if (joined === "wrangler whoami") return ok("You are logged in.\n");
      if (joined === "ngrok --version") return ok("ngrok version 3.0.0\n");
      if (joined === "ngrok config check") return ok("valid config\n");
      return failed(`unexpected command: ${joined}`);
    });

    const result = runInstallDoctor();

    assert.deepEqual(result, {
      ok: true,
      tools: {
        gcloud: {
          installed: true,
          loggedIn: true,
          version: "Google Cloud SDK 999.0.0",
        },
        wrangler: {
          installed: true,
          loggedIn: true,
          version: "wrangler 4.0.0",
        },
        ngrok: {
          installed: true,
          hasAuthToken: true,
          version: "ngrok version 3.0.0",
        },
        node: { version: process.version, ok: true },
      },
      missing: [],
    });
  });

  it("reports mixed install and login gaps", () => {
    mockSpawnSync((command, args = []) => {
      const joined = [command, ...args].join(" ");
      if (joined === "gcloud --version") return ok("Google Cloud SDK 999.0.0\n");
      if (joined === "gcloud auth list --format=json") return ok("[]");
      if (joined === "wrangler --version") return missingCommand("wrangler");
      if (joined === "ngrok --version") return ok("ngrok version 3.0.0\n");
      if (joined === "ngrok config check") return failed("authtoken missing");
      return failed(`unexpected command: ${joined}`);
    });

    const result = runInstallDoctor();

    assert.deepEqual(result, {
      ok: false,
      tools: {
        gcloud: {
          installed: true,
          loggedIn: false,
          version: "Google Cloud SDK 999.0.0",
        },
        wrangler: { installed: false, loggedIn: false },
        ngrok: {
          installed: true,
          hasAuthToken: false,
          version: "ngrok version 3.0.0",
        },
        node: { version: process.version, ok: true },
      },
      missing: [
        "Run `gcloud auth login`.",
        "Install Cloudflare Wrangler (`npm install -g wrangler`).",
        "Run `ngrok config add-authtoken <token>`.",
      ],
    });
  });
});
