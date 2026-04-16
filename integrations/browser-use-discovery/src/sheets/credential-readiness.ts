import { readFile } from "node:fs/promises";

import type { WorkerRuntimeConfig } from "../config.ts";

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
};

type GoogleOAuthToken = {
  token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  token_uri: string;
  expiry: string;
};

type FetchLike = typeof fetch;

export type SheetsCredentialSource =
  | "access_token"
  | "service_account_json"
  | "service_account_file"
  | "oauth_token_json"
  | "oauth_token_file";

export type SheetsCredentialReadiness = {
  configured: boolean;
  source: SheetsCredentialSource | null;
  message?: string;
  detail?: string;
  remediation?: string;
};

class CredentialFileError extends Error {
  kind: "missing" | "directory" | "unreadable";

  constructor(
    kind: "missing" | "directory" | "unreadable",
    message: string,
  ) {
    super(message);
    this.name = "CredentialFileError";
    this.kind = kind;
  }
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function parseServiceAccount(rawJson: string): GoogleServiceAccount {
  const parsed = JSON.parse(rawJson) as Partial<GoogleServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "Service account JSON must include client_email and private_key.",
    );
  }
  return {
    client_email: String(parsed.client_email),
    private_key: String(parsed.private_key),
  };
}

function parseOAuthToken(rawJson: string): GoogleOAuthToken {
  const parsed = JSON.parse(rawJson) as Partial<GoogleOAuthToken>;
  return {
    token: asText(parsed.token),
    refresh_token: asText(parsed.refresh_token),
    client_id: asText(parsed.client_id),
    client_secret: asText(parsed.client_secret),
    token_uri: asText(parsed.token_uri) || GOOGLE_TOKEN_URI,
    expiry: asText(parsed.expiry),
  };
}

function hasFreshOAuthAccessToken(
  tokenConfig: GoogleOAuthToken,
  now: () => Date,
): boolean {
  if (!tokenConfig.token) return false;
  if (!tokenConfig.expiry) return true;
  const expiryMs = Date.parse(tokenConfig.expiry);
  if (!Number.isFinite(expiryMs)) return true;
  return expiryMs - now().getTime() > 60_000;
}

function hasOAuthRefreshCredentials(tokenConfig: GoogleOAuthToken): boolean {
  return !!(
    tokenConfig.refresh_token &&
    tokenConfig.client_id &&
    tokenConfig.client_secret
  );
}

function assertUsableOAuthToken(
  tokenConfig: GoogleOAuthToken,
  now: () => Date,
): void {
  if (hasFreshOAuthAccessToken(tokenConfig, now)) {
    return;
  }
  if (hasOAuthRefreshCredentials(tokenConfig)) {
    return;
  }
  if (tokenConfig.token) {
    throw new Error(
      "Google OAuth token JSON only contains an expired access token. Add refresh_token, client_id, and client_secret, or replace it with a fresh token.",
    );
  }
  throw new Error(
    "Google OAuth token JSON must include a token or refresh_token, client_id, and client_secret.",
  );
}

async function refreshOAuthAccessToken(
  tokenConfig: GoogleOAuthToken,
  fetchImpl: FetchLike,
): Promise<void> {
  const response = await fetchImpl(tokenConfig.token_uri || GOOGLE_TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenConfig.refresh_token,
      client_id: tokenConfig.client_id,
      client_secret: tokenConfig.client_secret,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to refresh Google OAuth token: HTTP ${response.status}${body ? ` - ${body}` : ""}`,
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
  };
  if (!payload.access_token) {
    throw new Error("Google OAuth refresh response missing access_token");
  }
}

async function readCredentialFile(
  filePath: string,
  label: string,
): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as NodeJS.ErrnoException).code || "")
        : "";
    if (code === "ENOENT") {
      throw new CredentialFileError("missing", `${label} file does not exist.`);
    }
    if (code === "EISDIR") {
      throw new CredentialFileError(
        "directory",
        `${label} path points to a directory, not a JSON file.`,
      );
    }
    throw new CredentialFileError("unreadable", `${label} file is not readable.`);
  }
}

function invalidCredential(
  source: SheetsCredentialSource | null,
  message: string,
  detail: string,
  remediation: string,
): SheetsCredentialReadiness {
  return {
    configured: false,
    source,
    message,
    detail,
    remediation,
  };
}

export async function validateSheetsCredentialReadiness(
  runtimeConfig: WorkerRuntimeConfig,
  options: {
    now?: () => Date;
    fetchImpl?: FetchLike;
  } = {},
): Promise<SheetsCredentialReadiness> {
  const now = options.now || (() => new Date());
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (asText(runtimeConfig.googleAccessToken)) {
    return {
      configured: true,
      source: "access_token",
    };
  }

  const serviceAccountJson = asText(runtimeConfig.googleServiceAccountJson);
  if (serviceAccountJson) {
    try {
      parseServiceAccount(serviceAccountJson);
      return {
        configured: true,
        source: "service_account_json",
      };
    } catch (error) {
      return invalidCredential(
        "service_account_json",
        "Discovery worker Google service account JSON is invalid.",
        formatError(error),
        "Set BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_JSON to valid service-account JSON, or use BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE.",
      );
    }
  }

  const serviceAccountFile = asText(runtimeConfig.googleServiceAccountFile);
  if (serviceAccountFile) {
    try {
      parseServiceAccount(
        await readCredentialFile(serviceAccountFile, "Google service account"),
      );
      return {
        configured: true,
        source: "service_account_file",
      };
    } catch (error) {
      return invalidCredential(
        "service_account_file",
        error instanceof CredentialFileError
          ? "Discovery worker Google service account file is unreadable."
          : "Discovery worker Google service account file is invalid.",
        formatError(error),
        "Point BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE at a readable service-account JSON file, or use BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_JSON.",
      );
    }
  }

  const oauthTokenJson = asText(runtimeConfig.googleOAuthTokenJson);
  if (oauthTokenJson) {
    try {
      const tokenConfig = parseOAuthToken(oauthTokenJson);
      assertUsableOAuthToken(tokenConfig, now);
      if (
        !hasFreshOAuthAccessToken(tokenConfig, now) &&
        hasOAuthRefreshCredentials(tokenConfig)
      ) {
        await refreshOAuthAccessToken(tokenConfig, fetchImpl);
      }
      return {
        configured: true,
        source: "oauth_token_json",
      };
    } catch (error) {
      return invalidCredential(
        "oauth_token_json",
        "Discovery worker Google OAuth token JSON is invalid.",
        formatError(error),
        "Set BROWSER_USE_DISCOVERY_GOOGLE_OAUTH_TOKEN_JSON to valid Google OAuth token JSON, or use BROWSER_USE_DISCOVERY_GOOGLE_OAUTH_TOKEN_FILE.",
      );
    }
  }

  const oauthTokenFile = asText(runtimeConfig.googleOAuthTokenFile);
  if (oauthTokenFile) {
    try {
      const tokenConfig = parseOAuthToken(
        await readCredentialFile(oauthTokenFile, "Google OAuth token"),
      );
      assertUsableOAuthToken(tokenConfig, now);
      if (
        !hasFreshOAuthAccessToken(tokenConfig, now) &&
        hasOAuthRefreshCredentials(tokenConfig)
      ) {
        await refreshOAuthAccessToken(tokenConfig, fetchImpl);
      }
      return {
        configured: true,
        source: "oauth_token_file",
      };
    } catch (error) {
      return invalidCredential(
        "oauth_token_file",
        error instanceof CredentialFileError
          ? "Discovery worker Google OAuth token file is unreadable."
          : "Discovery worker Google OAuth token file is invalid.",
        formatError(error),
        "Point BROWSER_USE_DISCOVERY_GOOGLE_OAUTH_TOKEN_FILE at a readable Google OAuth token JSON file, or provide a fresh access token with BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN.",
      );
    }
  }

  return invalidCredential(
    null,
    "Discovery worker has no Google Sheets credential configured.",
    "Set a Google service account file/JSON, a Google access token, or a Google OAuth token file before running discovery.",
    "Set BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE, BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_JSON, BROWSER_USE_DISCOVERY_GOOGLE_ACCESS_TOKEN, BROWSER_USE_DISCOVERY_GOOGLE_OAUTH_TOKEN_FILE, or BROWSER_USE_DISCOVERY_GOOGLE_OAUTH_TOKEN_JSON.",
  );
}

export function formatSheetsCredentialReadinessWarning(
  readiness: SheetsCredentialReadiness,
): string {
  return [readiness.message, readiness.detail].filter(Boolean).join(" ");
}
