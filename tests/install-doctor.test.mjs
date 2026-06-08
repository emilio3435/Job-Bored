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
        tailscale: { installed: false },
        vercel: { installed: false },
        netlify: { installed: false },
        gh: { installed: false },
        node: { version: process.version, ok: true, required: ">=24 <25" },
      },
      missing: [
        "Install Google Cloud CLI (`gcloud`).",
        "Install Cloudflare Wrangler (`npm install -g wrangler`).",
        "Install ngrok.",
        "Install Tailscale CLI (`tailscale`).",
        "Install Vercel CLI (`npm install -g vercel`).",
        "Install Netlify CLI (`npm install -g netlify-cli`).",
        "Install GitHub CLI (`gh`).",
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
      if (joined === "tailscale version") return ok("1.78.1\n");
      if (joined === "tailscale status --json") {
        return ok(
          JSON.stringify({
            Self: { DNSName: "macbook.tailnet.ts.net." },
            CurrentTailnet: { Name: "tailnet.ts.net" },
          }),
        );
      }
      if (joined === "vercel --version") return ok("Vercel CLI 39.1.0\n");
      if (joined === "vercel whoami") return ok("user@example.com\n");
      if (joined === "netlify --version") return ok("netlify-cli/17.33.5 darwin-arm64 node-v24.0.0\n");
      if (joined === "netlify status") return ok("Logged in to Netlify\n");
      if (joined === "gh --version") return ok("gh version 2.64.0 (2026-01-01)\n");
      if (joined === "gh auth status") return ok("Logged in to github.com\n");
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
        tailscale: {
          installed: true,
          loggedIn: true,
          version: "1.78.1",
          dnsName: "macbook.tailnet.ts.net",
        },
        vercel: {
          installed: true,
          loggedIn: true,
          version: "Vercel CLI 39.1.0",
        },
        netlify: {
          installed: true,
          loggedIn: true,
          version: "netlify-cli/17.33.5 darwin-arm64 node-v24.0.0",
        },
        gh: {
          installed: true,
          loggedIn: true,
          version: "gh version 2.64.0 (2026-01-01)",
        },
        node: { version: process.version, ok: true, required: ">=24 <25" },
      },
      missing: [],
    });
  });

  it("reports go-live CLI login gaps when tools are installed but not authenticated", () => {
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
      if (joined === "tailscale version") return ok("1.78.1\n");
      if (joined === "tailscale status --json") return failed("Logged out.");
      if (joined === "vercel --version") return ok("Vercel CLI 39.1.0\n");
      if (joined === "vercel whoami") return failed("No existing credentials found.");
      if (joined === "netlify --version") return ok("netlify-cli/17.33.5\n");
      if (joined === "netlify status") return failed("Not logged in.");
      if (joined === "gh --version") return ok("gh version 2.64.0\n");
      if (joined === "gh auth status") return failed("You are not logged into any GitHub hosts");
      return failed(`unexpected command: ${joined}`);
    });

    const result = runInstallDoctor();

    assert.equal(result.ok, false);
    assert.deepEqual(result.tools.tailscale, {
      installed: true,
      loggedIn: false,
      version: "1.78.1",
      dnsName: null,
    });
    assert.deepEqual(result.tools.vercel, {
      installed: true,
      loggedIn: false,
      version: "Vercel CLI 39.1.0",
    });
    assert.deepEqual(result.tools.netlify, {
      installed: true,
      loggedIn: false,
      version: "netlify-cli/17.33.5",
    });
    assert.deepEqual(result.tools.gh, {
      installed: true,
      loggedIn: false,
      version: "gh version 2.64.0",
    });
    assert.deepEqual(result.missing, [
      "Run `tailscale up`.",
      "Run `vercel login`.",
      "Run `netlify login`.",
      "Run `gh auth login`.",
    ]);
  });

  it("reports mixed install and login gaps", () => {
    mockSpawnSync((command, args = []) => {
      const joined = [command, ...args].join(" ");
      if (joined === "gcloud --version") return ok("Google Cloud SDK 999.0.0\n");
      if (joined === "gcloud auth list --format=json") return ok("[]");
      if (joined === "wrangler --version") return missingCommand("wrangler");
      if (joined === "ngrok --version") return ok("ngrok version 3.0.0\n");
      if (joined === "ngrok config check") return failed("authtoken missing");
      if (joined === "tailscale version") return missingCommand("tailscale");
      if (joined === "vercel --version") return ok("Vercel CLI 39.1.0\n");
      if (joined === "vercel whoami") return failed("No existing credentials found.");
      if (joined === "netlify --version") return missingCommand("netlify");
      if (joined === "gh --version") return ok("gh version 2.64.0\n");
      if (joined === "gh auth status") return ok("Logged in to github.com\n");
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
        tailscale: { installed: false },
        vercel: {
          installed: true,
          loggedIn: false,
          version: "Vercel CLI 39.1.0",
        },
        netlify: { installed: false },
        gh: {
          installed: true,
          loggedIn: true,
          version: "gh version 2.64.0",
        },
        node: { version: process.version, ok: true, required: ">=24 <25" },
      },
      missing: [
        "Run `gcloud auth login`.",
        "Install Cloudflare Wrangler (`npm install -g wrangler`).",
        "Run `ngrok config add-authtoken <token>`.",
        "Install Tailscale CLI (`tailscale`).",
        "Run `vercel login`.",
        "Install Netlify CLI (`npm install -g netlify-cli`).",
      ],
    });
  });
});
