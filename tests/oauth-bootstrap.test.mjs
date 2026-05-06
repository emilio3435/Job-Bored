import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { afterEach, describe, it, mock } from "node:test";

import { runOAuthBootstrap } from "../scripts/oauth-bootstrap.mjs";

function ok(stdout = "", stderr = "") {
  return { status: 0, stdout, stderr };
}

function failed(stderr = "", status = 1) {
  return { status, stdout: "", stderr };
}

function missingCommand() {
  const error = new Error("spawnSync gcloud ENOENT");
  error.code = "ENOENT";
  return { status: null, stdout: "", stderr: "", error };
}

function mockSpawnSync(handler) {
  const calls = [];
  mock.method(childProcess, "spawnSync", (command, args = []) => {
    calls.push({ command, args });
    return handler(command, args);
  });
  return calls;
}

afterEach(() => {
  mock.restoreAll();
});

describe("oauth bootstrap", () => {
  it("returns gcloud_missing when gcloud is unavailable", () => {
    mockSpawnSync(() => missingCommand());

    const result = runOAuthBootstrap({ projectId: "demo-project" });

    assert.deepEqual(result, {
      ok: false,
      reason: "gcloud_missing",
      actionable: "Install Google Cloud CLI (`gcloud`) then click again",
    });
  });

  it("returns not_logged_in without launching gcloud auth login", () => {
    const calls = mockSpawnSync((_command, args) => {
      if (args.join(" ") === "--version") return ok("Google Cloud SDK 999.0.0\n");
      if (args.join(" ") === "auth list --format=json") return ok("[]");
      return failed("unexpected command");
    });

    const result = runOAuthBootstrap({ projectId: "demo-project" });

    assert.deepEqual(result, {
      ok: false,
      reason: "not_logged_in",
      actionable: "Run `gcloud auth login` then click again",
    });
    assert.equal(
      calls.some((call) => call.args.join(" ") === "auth login"),
      false,
    );
  });

  it("surfaces accessNotConfigured as api_disabled", () => {
    mockSpawnSync((_command, args) => {
      const joined = args.join(" ");
      if (joined === "--version") return ok("Google Cloud SDK 999.0.0\n");
      if (joined === "auth list --format=json") {
        return ok('[{"account":"user@example.com","status":"ACTIVE"}]');
      }
      if (args[0] === "services") {
        return failed("accessNotConfigured: IAM API has not been used");
      }
      return failed("unexpected command");
    });

    const result = runOAuthBootstrap({ projectId: "demo-project" });

    assert.deepEqual(result, {
      ok: false,
      reason: "api_disabled",
      actionable: "Run `gcloud services enable iam.googleapis.com oauth2.googleapis.com`",
    });
  });

  it("creates an OAuth client through gcloud when prerequisites pass", () => {
    const calls = mockSpawnSync((_command, args) => {
      const joined = args.join(" ");
      if (joined === "--version") return ok("Google Cloud SDK 999.0.0\n");
      if (joined === "auth list --format=json") {
        return ok('[{"account":"user@example.com","status":"ACTIVE"}]');
      }
      if (args[0] === "services") {
        return ok(
          JSON.stringify([
            { config: { name: "iam.googleapis.com" } },
            { config: { name: "oauth2.googleapis.com" } },
          ]),
        );
      }
      if (args[0] === "iam" && args[1] === "oauth-clients" && args[2] === "create") {
        return ok(
          JSON.stringify({
            name: "projects/demo-project/locations/global/oauthClients/client-123",
            clientId: "client-123.apps.googleusercontent.com",
          }),
        );
      }
      return failed(`unexpected command: ${joined}`);
    });

    const result = runOAuthBootstrap({
      projectId: "demo-project",
      applicationName: "JobBored",
    });

    assert.deepEqual(result, {
      ok: true,
      clientId: "client-123.apps.googleusercontent.com",
      source: "gcloud",
    });
    const createCall = calls.find(
      (call) =>
        call.args[0] === "iam" &&
        call.args[1] === "oauth-clients" &&
        call.args[2] === "create",
    );
    assert.ok(createCall);
    assert.ok(
      createCall.args.includes(
        "--allowed-redirect-uris=http://localhost:8080,http://127.0.0.1:8080",
      ),
    );
    assert.ok(createCall.args.includes("--project=demo-project"));
  });
});
