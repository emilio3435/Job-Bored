function result({ status = 0, stdout = "", stderr = "", error = null } = {}) {
  return {
    status,
    signal: null,
    stdout,
    stderr,
    error,
  };
}

function notFound(command) {
  const error = new Error(`spawnSync ${command} ENOENT`);
  error.code = "ENOENT";
  return result({ status: null, stderr: `${command}: command not found\n`, error });
}

export function createWranglerSpawnSync({
  installed = true,
  loggedIn = true,
  version = "4.14.1",
  account = "qa@example.test",
  workerUrl = "https://job-bored-qa.example.workers.dev",
  deployOk = true,
} = {}) {
  const calls = [];

  function spawnSync(command, args = [], options = {}) {
    const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
    calls.push({ command, args: normalizedArgs, options });

    if (command !== "wrangler" && command !== "npx") return notFound(command);
    if (!installed) return notFound(command);

    const wranglerArgs =
      command === "npx" && normalizedArgs[0] === "wrangler"
        ? normalizedArgs.slice(1)
        : normalizedArgs;

    if (wranglerArgs.length === 1 && wranglerArgs[0] === "--version") {
      return result({ stdout: `wrangler ${version}\n` });
    }

    if (wranglerArgs[0] === "whoami") {
      if (!loggedIn) {
        return result({
          status: 1,
          stderr: "You are not authenticated. Run `wrangler login`.\n",
        });
      }
      return result({ stdout: `Logged in as ${account}\n` });
    }

    if (wranglerArgs[0] === "deploy") {
      if (!loggedIn) {
        return result({
          status: 1,
          stderr: "Error: Not authenticated. Run `wrangler login`.\n",
        });
      }
      if (!deployOk) {
        return result({ status: 1, stderr: "Error: deploy failed\n" });
      }
      if (wranglerArgs.includes("--json")) {
        return result({ stdout: `${JSON.stringify({ url: workerUrl })}\n` });
      }
      return result({ stdout: `Uploaded. Worker URL: ${workerUrl}\n` });
    }

    if (wranglerArgs[0] === "secret" && wranglerArgs[1] === "put") {
      if (!loggedIn) return result({ status: 1, stderr: "Not authenticated.\n" });
      return result({ stdout: "Success! Uploaded secret.\n" });
    }

    return result({ stdout: "" });
  }

  spawnSync.calls = calls;
  return spawnSync;
}

export default createWranglerSpawnSync;
