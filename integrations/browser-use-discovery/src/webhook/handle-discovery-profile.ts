/**
 * Feature B / Layer 5 — POST /discovery-profile
 *
 * Accepts a resume text and/or a structured form, runs the two-step Gemini
 * profile extraction + company discovery, and (optionally) writes the resulting
 * CompanyTarget[] back to worker-config.json so subsequent discovery runs are
 * company-anchored instead of broadcast.
 *
 * Privacy: raw resume text is read from the request body into in-memory
 * variables only. No log call includes `resumeText`; only its length. The field
 * is stripped before any downstream pass-through. Nothing is persisted to
 * SQLite. Persisted state is limited to the inferred `CompanyTarget[]` (public
 * info) and, via the normalized config path, the fields the caller opted into.
 */

import {
  DISCOVERY_PROFILE_EVENT,
  DISCOVERY_PROFILE_SCHEMA_VERSION,
} from "../contracts.ts";
import type {
  CandidateProfile,
  CompanyTarget,
  DiscoveryProfileRequestV1,
  DiscoveryProfileResponseV1,
  ProfileFormInput,
  StoredWorkerConfig,
  WorkerRuntimeConfig,
} from "../contracts.ts";
import {
  extractCandidateProfile,
  discoverCompaniesForProfile,
} from "../discovery/profile-to-companies.ts";
import {
  hasValidWebhookSecret,
  type WebhookRequestLike,
  type WebhookResponseLike,
} from "./handle-discovery-webhook.ts";

type FetchImpl = typeof globalThis.fetch;

export type HandleDiscoveryProfileDependencies = {
  runtimeConfig: WorkerRuntimeConfig;
  fetchImpl?: FetchImpl;
  log?(event: string, details: Record<string, unknown>): void;
  /**
   * Optional override so tests can stub the config writer. Production uses
   * `upsertStoredWorkerConfig` from `src/config.ts`.
   */
  upsertStoredWorkerConfig?(
    runtimeConfig: WorkerRuntimeConfig,
    input: {
      sheetId: string;
      mutations: Partial<StoredWorkerConfig>;
    },
  ): Promise<StoredWorkerConfig>;
  /**
   * Required for mode:"refresh" and mode:"skip_company". Loads the current
   * StoredWorkerConfig so refresh runs can replay the stored candidateProfile
   * and dedupe against negativeCompanyKeys.
   */
  loadStoredWorkerConfig?(sheetId: string): Promise<StoredWorkerConfig | null>;
  /**
   * Optional overrides so tests can inject canned profile and company results
   * without mocking Gemini. Production leaves these unset; the handler uses
   * the real `extractCandidateProfile` / `discoverCompaniesForProfile`.
   */
  extractCandidateProfile?: typeof extractCandidateProfile;
  discoverCompaniesForProfile?: typeof discoverCompaniesForProfile;
};

function jsonResponse(
  status: number,
  body: DiscoveryProfileResponseV1 | Record<string, unknown>,
  headers: Record<string, string> = {},
): WebhookResponseLike {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: JSON.stringify(body),
  };
}

function parseRequest(bodyText: string):
  | { ok: true; request: DiscoveryProfileRequestV1 }
  | { ok: false; message: string; detail?: string } {
  let payload: unknown;
  try {
    payload = JSON.parse(String(bodyText || ""));
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, message: "Request body must be a JSON object." };
  }
  const record = payload as Record<string, unknown>;
  if (record.event !== DISCOVERY_PROFILE_EVENT) {
    return {
      ok: false,
      message: `event must be ${DISCOVERY_PROFILE_EVENT}.`,
    };
  }
  if (Number(record.schemaVersion) !== DISCOVERY_PROFILE_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `schemaVersion must be ${DISCOVERY_PROFILE_SCHEMA_VERSION}.`,
    };
  }
  const resumeText =
    typeof record.resumeText === "string" ? record.resumeText : "";
  const rawForm =
    record.form && typeof record.form === "object" && !Array.isArray(record.form)
      ? (record.form as Record<string, unknown>)
      : undefined;
  // Validate form field types: all ProfileFormInput fields are strings except
  // yearsOfExperience (number|string). Reject arrays/objects/bools so they
  // can't end up stringified as "[object Object]" inside the Gemini prompt
  // (codex-challenge finding E-5).
  let form: ProfileFormInput | undefined;
  if (rawForm) {
    const stringFields = [
      "targetRoles",
      "skills",
      "seniority",
      "locations",
      "remotePolicy",
      "industries",
    ] as const;
    for (const field of stringFields) {
      const value = rawForm[field];
      if (value !== undefined && typeof value !== "string") {
        return {
          ok: false,
          message: `form.${field} must be a string when present.`,
        };
      }
    }
    const yoeRaw = rawForm.yearsOfExperience;
    if (
      yoeRaw !== undefined &&
      typeof yoeRaw !== "number" &&
      typeof yoeRaw !== "string"
    ) {
      return {
        ok: false,
        message: "form.yearsOfExperience must be a number or numeric string when present.",
      };
    }
    form = rawForm as ProfileFormInput;
  }
  const rawMode = typeof record.mode === "string" ? record.mode : "manual";
  const mode: "manual" | "refresh" | "skip_company" | "status" =
    rawMode === "refresh"
      ? "refresh"
      : rawMode === "skip_company"
        ? "skip_company"
        : rawMode === "status"
          ? "status"
          : "manual";

  // Only manual mode requires resume/form at the request level. Refresh
  // pulls from the stored candidateProfile; skip_company only touches the
  // negative list; status short-circuits before Gemini.
  if (mode === "manual" && !resumeText.trim() && !hasAnyFormField(form)) {
    return {
      ok: false,
      message: "At least one of resumeText or form must be non-blank.",
      detail:
        "Supply resumeText (extracted plain text from the user's resume) and/or a `form` object with at least one filled field (targetRoles, skills, seniority, etc.).",
    };
  }

  let skipCompanyKeys: string[] | undefined;
  if (mode === "skip_company") {
    const rawSkip = Array.isArray(record.skipCompanyKeys)
      ? record.skipCompanyKeys
      : [];
    skipCompanyKeys = rawSkip
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (skipCompanyKeys.length === 0) {
      return {
        ok: false,
        message: "skipCompanyKeys must be a non-empty array of strings when mode=skip_company.",
      };
    }
  }

  const sheetId = typeof record.sheetId === "string" ? record.sheetId.trim() : "";
  const persist =
    typeof record.persist === "boolean" ? record.persist : false;
  return {
    ok: true,
    request: {
      event: DISCOVERY_PROFILE_EVENT,
      schemaVersion: DISCOVERY_PROFILE_SCHEMA_VERSION,
      resumeText: resumeText.trim() ? resumeText : undefined,
      form,
      persist,
      sheetId: sheetId || undefined,
      mode,
      skipCompanyKeys,
    },
  };
}

function hasAnyFormField(form: ProfileFormInput | undefined): boolean {
  if (!form) return false;
  return Object.values(form).some((value) => {
    if (typeof value === "string") return value.trim() !== "";
    if (typeof value === "number") return Number.isFinite(value);
    return false;
  });
}

export async function handleDiscoveryProfileWebhook(
  request: WebhookRequestLike,
  dependencies: HandleDiscoveryProfileDependencies,
): Promise<WebhookResponseLike> {
  if (String(request.method || "").toUpperCase() !== "POST") {
    return jsonResponse(
      405,
      { ok: false, message: "Method not allowed" },
      { allow: "POST,OPTIONS" },
    );
  }

  const authCheck = hasValidWebhookSecret(
    dependencies.runtimeConfig.webhookSecret,
    request.headers,
  );
  if (!authCheck.valid) {
    return jsonResponse(401, {
      ok: false,
      message: "Unauthorized discovery-profile request.",
      auth: {
        category: authCheck.category,
        detail: authCheck.detail,
        ...(authCheck.remediation ? { remediation: authCheck.remediation } : {}),
      },
    });
  }

  const parsed = parseRequest(request.bodyText);
  if (!parsed.ok) {
    return jsonResponse(400, {
      ok: false,
      message: parsed.message,
      ...(parsed.detail ? { detail: parsed.detail } : {}),
    });
  }

  const { request: parsedRequest } = parsed;
  const resumeTextLength = parsedRequest.resumeText
    ? parsedRequest.resumeText.length
    : 0;
  const formFieldCount = hasAnyFormField(parsedRequest.form)
    ? Object.values(parsedRequest.form as ProfileFormInput).filter((value) => {
        if (typeof value === "string") return value.trim() !== "";
        if (typeof value === "number") return Number.isFinite(value);
        return false;
      }).length
    : 0;

  dependencies.log?.("discovery.profile.request_accepted", {
    resumeTextLength,
    formFieldCount,
    persist: parsedRequest.persist === true,
    hasSheetId: !!parsedRequest.sheetId,
    mode: parsedRequest.mode || "manual",
  });

  const extractFn =
    dependencies.extractCandidateProfile || extractCandidateProfile;
  const discoverFn =
    dependencies.discoverCompaniesForProfile || discoverCompaniesForProfile;

  // --- mode: status ---
  // Read-only snapshot for the dashboard's daily-refresh status panel. Never
  // calls Gemini. Returns the fields the UI needs to show whether a stored
  // profile exists, how many negative-list entries have been recorded, and
  // when the last successful refresh happened.
  if (parsedRequest.mode === "status") {
    const targetSheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!targetSheetId || typeof targetSheetId !== "string") {
      return jsonResponse(400, {
        ok: false,
        message: "sheetId is required for status mode.",
      });
    }
    if (!dependencies.loadStoredWorkerConfig) {
      return jsonResponse(500, {
        ok: false,
        message: "loadStoredWorkerConfig not wired; cannot read status.",
      });
    }
    try {
      const existing = await dependencies.loadStoredWorkerConfig(
        String(targetSheetId),
      );
      const storedProfile = existing?.candidateProfile;
      const storedResumeText =
        typeof storedProfile?.resumeText === "string"
          ? storedProfile.resumeText
          : "";
      const storedForm = storedProfile?.form;
      const storedFormFieldCount = storedForm
        ? Object.values(storedForm).filter((value) => {
            if (typeof value === "string") return value.trim() !== "";
            if (typeof value === "number") return Number.isFinite(value);
            return false;
          }).length
        : 0;
      const status = {
        hasStoredProfile: !!storedProfile,
        resumeTextLength: storedResumeText.length,
        formFieldCount: storedFormFieldCount,
        profileUpdatedAt:
          typeof storedProfile?.updatedAt === "string"
            ? storedProfile.updatedAt
            : null,
        companyCount: Array.isArray(existing?.companies)
          ? existing!.companies.length
          : 0,
        negativeCompanyCount: Array.isArray(existing?.negativeCompanyKeys)
          ? existing!.negativeCompanyKeys!.length
          : 0,
        lastRefreshAt: existing?.lastRefreshAt?.at || null,
        lastRefreshSource: existing?.lastRefreshAt?.source || null,
      };
      dependencies.log?.("discovery.profile.status", {
        hasStoredProfile: status.hasStoredProfile,
        companyCount: status.companyCount,
        negativeCompanyCount: status.negativeCompanyCount,
      });
      return jsonResponse(200, { ok: true, status });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "unknown error");
      dependencies.log?.("discovery.profile.status_failed", { message });
      return jsonResponse(502, {
        ok: false,
        message: "Failed to read status.",
        detail: message,
      });
    }
  }

  // --- mode: skip_company ---
  // Append the given companyKeys to the StoredWorkerConfig.negativeCompanyKeys
  // list so future refresh runs dedupe against them. No Gemini call.
  if (parsedRequest.mode === "skip_company") {
    const targetSheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!targetSheetId || typeof targetSheetId !== "string") {
      return jsonResponse(400, {
        ok: false,
        message: "sheetId is required for skip_company mode.",
      });
    }
    if (!dependencies.loadStoredWorkerConfig || !dependencies.upsertStoredWorkerConfig) {
      return jsonResponse(500, {
        ok: false,
        message: "Storage helpers not wired; cannot update skip list.",
      });
    }
    try {
      const existing = await dependencies.loadStoredWorkerConfig(
        String(targetSheetId),
      );
      const prior = Array.isArray(existing?.negativeCompanyKeys)
        ? existing!.negativeCompanyKeys!
        : [];
      const merged = Array.from(
        new Set([...prior, ...(parsedRequest.skipCompanyKeys || [])]),
      );
      await dependencies.upsertStoredWorkerConfig(dependencies.runtimeConfig, {
        sheetId: String(targetSheetId),
        mutations: { negativeCompanyKeys: merged },
      });
      dependencies.log?.("discovery.profile.skip_recorded", {
        added: parsedRequest.skipCompanyKeys?.length || 0,
        totalSkipped: merged.length,
      });
      return jsonResponse(200, {
        ok: true,
        profile: {
          targetRoles: [],
          skills: [],
          seniority: "",
          locations: [],
          industries: [],
        },
        companies: [],
        persisted: true,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error || "unknown error");
      dependencies.log?.("discovery.profile.skip_failed", { message });
      return jsonResponse(502, {
        ok: false,
        message: "Failed to record skip list.",
        detail: message,
      });
    }
  }

  // --- mode: refresh ---
  // Replay stored candidateProfile against Gemini and dedupe against
  // negativeCompanyKeys. No new input accepted.
  let refreshResumeText: string | undefined = parsedRequest.resumeText;
  let refreshForm: ProfileFormInput | undefined = parsedRequest.form;
  let negativeCompanyKeys: string[] = [];
  let refreshStoredSheetId: string | null = null;

  if (parsedRequest.mode === "refresh") {
    const targetSheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!targetSheetId || typeof targetSheetId !== "string") {
      return jsonResponse(400, {
        ok: false,
        message: "sheetId is required for refresh mode.",
      });
    }
    if (!dependencies.loadStoredWorkerConfig) {
      return jsonResponse(500, {
        ok: false,
        message: "loadStoredWorkerConfig not wired; refresh requires stored profile.",
      });
    }
    const existing = await dependencies.loadStoredWorkerConfig(
      String(targetSheetId),
    );
    if (!existing || !existing.candidateProfile) {
      return jsonResponse(400, {
        ok: false,
        message:
          "No stored candidateProfile found. Run a manual /discovery-profile with persist:true first so refresh has something to replay.",
      });
    }
    refreshResumeText = existing.candidateProfile.resumeText;
    refreshForm = existing.candidateProfile.form;
    negativeCompanyKeys = Array.isArray(existing.negativeCompanyKeys)
      ? existing.negativeCompanyKeys
      : [];
    refreshStoredSheetId = String(targetSheetId);
    dependencies.log?.("discovery.profile.refresh_loaded", {
      hasStoredResume: !!refreshResumeText,
      hasStoredForm: !!refreshForm,
      negativeCompanyCount: negativeCompanyKeys.length,
    });
  }

  let profile: CandidateProfile;
  try {
    profile = await extractFn(
      {
        resumeText: refreshResumeText,
        form: refreshForm,
      },
      {
        runtimeConfig: dependencies.runtimeConfig,
        fetchImpl: dependencies.fetchImpl,
        log: dependencies.log,
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "unknown error");
    dependencies.log?.("discovery.profile.extract_failed", { message });
    return jsonResponse(502, {
      ok: false,
      message: "Profile extraction failed.",
      detail: message,
    });
  }

  let companies: CompanyTarget[];
  try {
    companies = await discoverFn(profile, {
      runtimeConfig: dependencies.runtimeConfig,
      fetchImpl: dependencies.fetchImpl,
      log: dependencies.log,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error || "unknown error");
    dependencies.log?.("discovery.profile.discover_failed", { message });
    return jsonResponse(502, {
      ok: false,
      message: "Company discovery failed.",
      detail: message,
    });
  }

  // Refresh mode: dedupe against stored negative list so skipped companies
  // never re-appear in the persisted list regardless of what Gemini suggested.
  if (parsedRequest.mode === "refresh" && negativeCompanyKeys.length > 0) {
    const blocked = new Set(negativeCompanyKeys);
    const beforeCount = companies.length;
    companies = companies.filter((company) => !blocked.has(company.companyKey));
    dependencies.log?.("discovery.profile.refresh_deduped", {
      beforeCount,
      afterCount: companies.length,
      negativeCompanyCount: negativeCompanyKeys.length,
    });
  }

  // Refresh mode implicitly persists (no `persist` flag in the cron request).
  const shouldPersist =
    parsedRequest.mode === "refresh" || parsedRequest.persist === true;

  let persisted = false;
  if (shouldPersist && companies.length > 0) {
    const targetSheetId =
      parsedRequest.sheetId ||
      (dependencies.runtimeConfig as Record<string, unknown>).defaultSheetId ||
      "";
    if (!targetSheetId || typeof targetSheetId !== "string") {
      dependencies.log?.("discovery.profile.persist_skipped", {
        reason: "missing_sheet_id",
        companyCount: companies.length,
      });
    } else if (!dependencies.upsertStoredWorkerConfig) {
      dependencies.log?.("discovery.profile.persist_skipped", {
        reason: "upsert_helper_not_wired",
        companyCount: companies.length,
      });
    } else {
      // Strip profile-derived tags before persisting. `companies` is durable
      // public state (written to the worker-config JSON / sheet-anchored
      // config); roleTags/geoTags are inferred from the candidate's profile
      // and constitute intent PII. The in-memory response still carries the
      // full company shape for the caller's preview.
      const persistedCompanies = companies.map((company) => {
        const {
          roleTags: _roleTags,
          geoTags: _geoTags,
          ...rest
        } = company;
        return rest;
      });
      // Save the candidateProfile alongside the companies when this was a
      // manual persist (not a refresh — refresh is replaying what's already
      // stored). This lets the scheduled daily refresh call /discovery-profile
      // {mode:"refresh"} and replay the last-used inputs without any UI
      // interaction.
      const candidateProfileMutation =
        parsedRequest.mode !== "refresh"
          ? {
              candidateProfile: {
                resumeText: parsedRequest.resumeText,
                form: parsedRequest.form,
                updatedAt: new Date().toISOString(),
              },
            }
          : {};
      const refreshSource: "manual" | "refresh" =
        parsedRequest.mode === "refresh" ? "refresh" : "manual";
      const lastRefreshAt = {
        at: new Date().toISOString(),
        source: refreshSource,
      };
      try {
        await dependencies.upsertStoredWorkerConfig(dependencies.runtimeConfig, {
          sheetId: String(targetSheetId),
          mutations: {
            companies: persistedCompanies,
            lastRefreshAt,
            ...candidateProfileMutation,
          },
        });
        persisted = true;
        dependencies.log?.("discovery.profile.persisted", {
          companyCount: companies.length,
          sheetId: String(targetSheetId),
          storedCandidateProfile: parsedRequest.mode !== "refresh",
          source: refreshSource,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error || "unknown error");
        dependencies.log?.("discovery.profile.persist_failed", { message });
        return jsonResponse(502, {
          ok: false,
          message: "Persist failed after successful discovery.",
          detail: message,
        });
      }
    }
  }

  dependencies.log?.("discovery.profile.request_completed", {
    companyCount: companies.length,
    persisted,
    targetRoleCount: profile.targetRoles.length,
  });

  const response: DiscoveryProfileResponseV1 = {
    ok: true,
    profile,
    companies,
    persisted,
  };
  return jsonResponse(200, response);
}
