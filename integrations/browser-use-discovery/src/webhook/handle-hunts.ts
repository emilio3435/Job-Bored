/**
 * handle-hunts.ts — HOLES HUNT: the dispatcher that sends a saved hunt's run
 * through the same in-process handler as POST /webhook. Contract:
 * docs/INTERFACE-HUNTS.md §4.3.
 */

import {
  DISCOVERY_WEBHOOK_EVENT,
  DISCOVERY_WEBHOOK_SCHEMA_VERSION,
} from "../contracts.ts";
import type { HuntDispatcher } from "../scheduler/hunt-scheduler.ts";
import { applyHuntTweaks } from "../state/hunt-store.ts";
import {
  deriveIdempotentRunId,
  type WebhookRequestLike,
  type WebhookResponseLike,
} from "./handle-discovery-webhook.ts";

export interface HuntRunDispatcherDependencies {
  webhookSecret: string;
  /** The in-process POST /webhook handler (built with allowMissingSheetsCredential). */
  handleDiscovery(request: WebhookRequestLike): Promise<WebhookResponseLike>;
  now(): Date;
  /** A last check right before posting, so a hunt never starts over a live run. */
  isRunActive?(): boolean;
  /** Hands the hunt's exploration share to the run, keyed by its run id. */
  rememberRunShare?(runId: string, share: number): void;
}

const PROFILE_QUERY_KEYS = [
  "targetRoles",
  "locations",
  "remotePolicy",
  "seniority",
  "keywordsInclude",
  "keywordsExclude",
] as const;

export function createHuntRunDispatcher(dependencies: HuntRunDispatcherDependencies): HuntDispatcher {
  return async (hunt, trigger, options = {}) => {
    if (dependencies.isRunActive?.()) {
      return { ok: false, status: 409, busy: true, message: "A discovery run is active; the hunt stays queued." };
    }
    const requestedAt = dependencies.now().toISOString();
    // One key per schedule slot (a re-fire of the same slot is the same run);
    // one per click for run-now.
    const idempotencyKey =
      trigger === "scheduled-hunt"
        ? `hunt:${hunt.id}:${options.slotAt || requestedAt}`
        : `hunt:${hunt.id}:now:${requestedAt}`;
    const effectivePlan = applyHuntTweaks(hunt.searchPlan, hunt.tweaks);
    const query = effectivePlan.query || {};
    const discoveryProfile: Record<string, unknown> = {};
    for (const key of PROFILE_QUERY_KEYS) {
      const value = query[key];
      if (typeof value === "string" && value.trim()) discoveryProfile[key] = value;
    }
    if (query.sourcePreset) discoveryProfile.sourcePreset = query.sourcePreset;
    discoveryProfile.searchPlan = { ...effectivePlan, generatedAt: requestedAt, trigger };
    const body = {
      event: DISCOVERY_WEBHOOK_EVENT,
      schemaVersion: DISCOVERY_WEBHOOK_SCHEMA_VERSION,
      sheetId: hunt.sheetId,
      variationKey: `hunt-${hunt.id}-${requestedAt.replace(/[^0-9]/g, "").slice(0, 12)}`,
      requestedAt,
      trigger,
      idempotencyKey,
      discoveryProfile,
      ...(options.googleAccessToken ? { googleAccessToken: options.googleAccessToken } : {}),
    };
    // The webhook handler derives this same id; the share must be in place
    // before the run starts planning.
    const runId = deriveIdempotentRunId({ sheetId: hunt.sheetId, idempotencyKey });
    if (runId) dependencies.rememberRunShare?.(runId, hunt.explorationShare);
    const response = await dependencies.handleDiscovery({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discovery-secret": dependencies.webhookSecret,
      },
      bodyText: JSON.stringify(body),
    });
    const parsed = parseJsonObject(response.body);
    const ackRunId = typeof parsed?.runId === "string" ? parsed.runId : "";
    const accepted = response.status >= 200 && response.status < 300 && parsed?.ok === true && !!ackRunId;
    return {
      ok: accepted,
      status: response.status,
      ...(ackRunId ? { runId: ackRunId } : {}),
      ...(accepted
        ? {}
        : {
            message:
              typeof parsed?.message === "string" && parsed.message
                ? parsed.message
                : `Run was refused with HTTP ${response.status}.`,
          }),
      ...(parsed ? { body: parsed } : {}),
    };
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
