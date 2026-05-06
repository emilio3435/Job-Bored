const DEFAULT_CLIENT = {
  clientId: "qa-oauth-client.apps.googleusercontent.com",
  clientSecret: "qa-client-secret",
  name: "projects/qa-project/locations/global/oauthClients/qa-oauth-client",
};

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

function hasArg(args, value) {
  return args.includes(value);
}

export function createGcloudSpawnSync({
  installed = true,
  loggedIn = true,
  version = "Google Cloud SDK 471.0.0\n",
  account = "qa@example.test",
  client = DEFAULT_CLIENT,
  servicesEnabled = true,
} = {}) {
  const calls = [];

  function spawnSync(command, args = [], options = {}) {
    const normalizedArgs = Array.isArray(args) ? args.map(String) : [];
    calls.push({ command, args: normalizedArgs, options });

    if (command !== "gcloud") return notFound(command);
    if (!installed) return notFound(command);

    if (normalizedArgs.length === 1 && normalizedArgs[0] === "--version") {
      return result({ stdout: version });
    }

    if (normalizedArgs[0] === "auth" && normalizedArgs[1] === "list") {
      const accounts = loggedIn ? [{ account, status: "ACTIVE" }] : [];
      return result({ stdout: `${JSON.stringify(accounts)}\n` });
    }

    if (normalizedArgs[0] === "services" && normalizedArgs[1] === "enable") {
      if (!servicesEnabled) {
        return result({
          status: 1,
          stderr:
            "ERROR: (gcloud.services.enable) accessNotConfigured: API has not been used.\n",
        });
      }
      return result({ stdout: "Operation finished successfully.\n" });
    }

    if (normalizedArgs[0] === "services" && normalizedArgs[1] === "list") {
      const services = servicesEnabled
        ? [
            { config: { name: "iam.googleapis.com" } },
            { config: { name: "oauth2.googleapis.com" } },
          ]
        : [];
      return result({ stdout: `${JSON.stringify(services)}\n` });
    }

    if (
      normalizedArgs[0] === "iap" &&
      normalizedArgs[1] === "oauth-clients" &&
      normalizedArgs[2] === "create"
    ) {
      if (!loggedIn) {
        return result({
          status: 1,
          stderr: "ERROR: (gcloud.iap.oauth-clients.create) You do not currently have an active account.\n",
        });
      }
      if (!servicesEnabled) {
        return result({
          status: 1,
          stderr:
            "ERROR: (gcloud.iap.oauth-clients.create) accessNotConfigured: API has not been used.\n",
        });
      }
      if (hasArg(normalizedArgs, "--format=json")) {
        return result({ stdout: `${JSON.stringify(client)}\n` });
      }
      return result({
        stdout: [
          `Created OAuth client [${client.name}].`,
          `clientId: ${client.clientId}`,
          `secret: ${client.clientSecret}`,
          "",
        ].join("\n"),
      });
    }

    return result({ stdout: "" });
  }

  spawnSync.calls = calls;
  return spawnSync;
}

export default createGcloudSpawnSync;
