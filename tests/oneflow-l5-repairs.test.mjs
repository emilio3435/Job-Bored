import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";

import { runDoctor } from "../scripts/doctor.mjs";
import { getNodeVersionCheck } from "../scripts/install-repo.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;

function readRepoFile(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

async function createDoctorRepo({ trackedIntegrationLock }) {
  const root = await mkdtemp(join(tmpdir(), "jobbored-oneflow-l5-doctor-"));
  await mkdir(join(root, "schemas"), { recursive: true });
  await mkdir(join(root, "integrations", "browser-use-discovery"), {
    recursive: true,
  });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ engines: { node: ">=24 <25" } }, null, 2)}\n`,
  );
  await writeFile(join(root, ".nvmrc"), "24\n");
  await writeFile(join(root, ".node-version"), "24\n");
  await writeFile(
    join(root, "config.js"),
    "window.COMMAND_CENTER_CONFIG = {};\n",
  );
  await writeFile(
    join(root, "schemas", "pipeline-row.v1.json"),
    `${JSON.stringify({
      headerRow: ["Status"],
      columns: [{ id: "status", enum: ["New"] }],
    })}\n`,
  );
  await writeFile(
    join(root, "integrations", "browser-use-discovery", "package-lock.json"),
    '{"lockfileVersion":3}\n',
  );

  const spawnSyncImpl = (command, args = []) => {
    if (command === "git" && args.includes("ls-files")) {
      const asksForIntegrationLock = args.includes(
        "integrations/browser-use-discovery/package-lock.json",
      );
      return {
        status: 0,
        stdout:
          asksForIntegrationLock && trackedIntegrationLock
            ? "integrations/browser-use-discovery/package-lock.json\n"
            : "",
        stderr: "",
      };
    }
    if (command === "npm") {
      return { status: 0, stdout: "11.0.0\n", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "" };
  };

  return runDoctor({
    repoRoot: root,
    env: {},
    spawnSyncImpl,
    fetchImpl: async () => new Response("{}", { status: 403 }),
    checkPortImpl: async () => false,
  });
}

describe("ONEFLOW L5 Phase 0 repairs", () => {
  it("accepts every supported Node major from 20 upward while rejecting 19", () => {
    assert.equal(getNodeVersionCheck("v19.9.0").ok, false);
    assert.deepEqual(getNodeVersionCheck("v20.0.0"), {
      version: "v20.0.0",
      required: ">=20",
      ok: true,
    });
    assert.equal(getNodeVersionCheck("v24.1.0").ok, true);
    assert.equal(getNodeVersionCheck("v26.0.0").ok, true);
  });

  it("accepts the repository-tracked discovery lockfile and warns only when it is unexpected", async () => {
    const trackedReport = await createDoctorRepo({ trackedIntegrationLock: true });
    const trackedCheck = trackedReport.checks.find(
      (entry) => entry.name === "discovery lockfile policy",
    );
    assert.equal(trackedCheck.level, "ok");
    assert.match(trackedCheck.message, /tracked dependency lockfile/);

    const unexpectedReport = await createDoctorRepo({
      trackedIntegrationLock: false,
    });
    const unexpectedCheck = unexpectedReport.checks.find(
      (entry) => entry.name === "discovery lockfile policy",
    );
    assert.equal(unexpectedCheck.level, "warn");
    assert.match(unexpectedCheck.message, /not tracked by git/);
  });

  it("publishes the GIS start time so SetupDoctor can detect an 8-second stall", async () => {
    let now = 1_000_000;
    class TestDate extends Date {
      static now() {
        return now;
      }
    }
    const document = {
      addEventListener() {},
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      createElement() {
        return { addEventListener() {}, appendChild() {} };
      },
      head: { appendChild() {} },
    };
    const host = {
      getOAuthClientId: () => "test.apps.googleusercontent.com",
      renderAppsScriptDeployUi() {},
    };
    const window = {
      JobBoredApp: { core: { host } },
      document,
      getOAuthClientId: host.getOAuthClientId,
      location: { hostname: "localhost", origin: "http://localhost:8080" },
      navigator: { clipboard: { writeText: async () => {} } },
      fetch: () => Promise.reject(new Error("unexpected fetch")),
      open: () => null,
      showToast() {},
    };
    const context = vm.createContext({
      window,
      document,
      console,
      Date: TestDate,
      URL,
      Response,
      setTimeout: () => 1,
      clearTimeout() {},
    });

    vm.runInContext(readRepoFile("auth-session.js"), context, {
      filename: "auth-session.js",
    });
    window.JobBoredApp.auth.initAuth();
    assert.equal(window.gisInitStartedAt, now);

    now += 9000;
    vm.runInContext(readRepoFile("setup-doctor.js"), context, {
      filename: "setup-doctor.js",
    });
    const report = await window.SetupDoctor.diagnose({});
    assert.equal(
      report.issues.some((issue) => issue.id === "gis_stuck"),
      true,
    );
  });

  it("removes the false OAuth bootstrap without leaving a runtime route or caller", () => {
    assert.equal(existsSync(join(repoRoot, "scripts", "oauth-bootstrap.mjs")), false);
    for (const relativePath of [
      "dev-server.mjs",
      "setup-doctor.js",
      "sheet-access-setup.js",
    ]) {
      assert.doesNotMatch(
        readRepoFile(relativePath),
        /\/__proxy\/oauth-bootstrap/,
        `${relativePath} still calls or serves the deleted OAuth bootstrap`,
      );
    }
    // The toast this pinned lived on the login gate's own "create a Client
    // ID" sub-wizard, which §7 deleted — Beat 1 owns that step now, guide
    // included. The claim that survives is that nothing resurrects the
    // route, asserted above.
    assert.match(
      readRepoFile("oneflow-beat-google.js"),
      /oneFlowOauthClientIdInput/,
      "Beat 1 carries the Client ID step the gate used to duplicate",
    );
  });

  it("documents the same 25 Pipeline columns that the starter-sheet code creates", () => {
    const appConfigSource = readRepoFile("app-config-core.js");
    const headerArray = appConfigSource.match(
      /const STARTER_PIPELINE_HEADERS = (\[[\s\S]*?\n\s*\]);/,
    );
    assert.ok(headerArray, "STARTER_PIPELINE_HEADERS must remain readable");
    const starterHeaders = Array.from(vm.runInNewContext(headerArray[1]));

    const setup = readRepoFile("SETUP.md");
    assert.match(setup, /Pipeline.*25.*columns \(A.Y\)/);
    const documentedHeaders = [...setup.matchAll(/^\| [A-Y] +\| ([^|]+?) +\|/gm)].map(
      (match) => match[1].trim(),
    );
    assert.deepEqual(documentedHeaders, starterHeaders);
  });
});
