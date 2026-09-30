/**
 * The JOBQA fixture's API: an isolated Express app on a temp store.
 *
 * REAL handlers, with every path injected (no HOME, no ~/.jobbored, no
 * server/index.mjs boot): POST /profile/from-resume (read-only parsing,
 * with the MOCK provider below), POST /profile/contact/suggest, GET and
 * POST /profile/commit(/state), GET/POST /profile, POST /profile/contact,
 * PUT /profile/resume, GET /profile/resume/read, GET/PUT/DELETE
 * /profile/voice, POST /profile/template/:id, GET /api/applications/queue.
 *
 * MOCKS, labeled `fixtureMock: true`: the AI provider (fixtureAnalyze),
 * the LLM settings store, grading checks, the application list and chat.
 * Anything else answers 404 fixture_unknown_route and is logged.
 */

import { createRequire } from "node:module";

import { listPendingQueue } from "../../../server/application-materials.mjs";
import { createProfileFromResumeHandler } from "../../../server/profile-from-resume.mjs";
import { commitBarrier, createProfileCommitService, mountProfileCommit } from "../../../server/profile-commit.mjs";
import { carryForwardContact, contactOf, normalizeContact, withContact } from "../../../server/profile-identity.mjs";
import {
  currentResumeRead,
  suggestContactFromSources,
  validateResumeSync,
  writeCanonicalResume,
} from "../../../server/profile-resume-sync.mjs";
import { isVoiceError, readVoice, removeVoice, saveVoice } from "../../../server/profile-voice.mjs";
import { readCanonicalResume } from "../../../server/materials-resume-source.mjs";
import { readSavedResumeRead, saveResumeRead } from "../../../server/resume-read.mjs";
import { buildStarterTemplate, listStarterTemplateIds, readProfile, writeProfileAtomic } from "../../../server/user-profile.mjs";
import { fixtureAnalyze } from "./profiles.mjs";

const requireFromServer = createRequire(new URL("../../../server/package.json", import.meta.url));
/** @type {any} */
const express = requireFromServer("express");

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {{
 *   paths: ReturnType<typeof import("./profiles.mjs").storePaths>,
 *   webOrigins: string[],
 *   log?: (entry: Record<string, unknown>) => void,
 *   analyze?: typeof fixtureAnalyze,
 * }} options
 */
export function createFixtureApi({ paths, webOrigins, log = () => {}, analyze = fixtureAnalyze }) {
  const app = express();
  app.disable("x-powered-by");

  app.use((/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
    const origin = req.get("origin");
    if (origin) {
      if (!webOrigins.includes(origin)) {
        log({ kind: "origin_refused", origin, method: req.method, path: req.path });
        return res.status(403).json({ ok: false, reason: "fixture_origin_refused" });
      }
      res.set("access-control-allow-origin", origin);
      res.set("vary", "Origin");
      res.set("access-control-allow-headers", "content-type, authorization, x-api-token");
      res.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    log({ kind: "api", method: req.method, path: req.path });
    return next();
  });
  app.use(express.json({ limit: "16mb" }));

  const commitService = createProfileCommitService({
    paths,
    postCommit: async () => ({ fixtureMock: true, skipped: "claim ledger and logo refresh are skipped in the fixture" }),
  });
  /* The editors' saves never interleave with a commit or its rollback, as in server/index.mjs. */
  const guardSave = commitBarrier(commitService);

  const readSavedResumeText = async () => ((await readCanonicalResume({ path: paths.resume })) || { text: "" }).text;

  app.get("/health", (/** @type {any} */ _req, /** @type {any} */ res) => res.json({ ok: true, fixture: "jobqa-hermetic" }));

  /* Real read-only parsing; the provider behind it is the MOCK. */
  app.post(
    "/profile/from-resume",
    createProfileFromResumeHandler({
      analyze: (text) => analyze(text),
      readSaved: async () => {
        const saved = await readCanonicalResume({ path: paths.resume });
        return saved ? { text: saved.text, source: "jobbored_text", path: paths.resume } : null;
      },
      readCanonicalText: readSavedResumeText,
      saveRead: (read) => saveResumeRead(/** @type {any} */ (read), { path: paths.read }),
      signalFor: () => undefined,
    }),
  );

  app.post("/profile/contact/suggest", async (/** @type {any} */ req, /** @type {any} */ res) =>
    res.json(await suggestContactFromSources(isRecord(req.body) ? req.body : {}, { readSaved: readSavedResumeText })),
  );

  mountProfileCommit(app, commitService);

  app.get("/profile", async (/** @type {any} */ _req, /** @type {any} */ res) => {
    const result = await readProfile({ path: paths.profile });
    if (!result.ok) return res.json({ ok: false, reason: result.reason });
    return res.json({ ok: true, profile: result.profile });
  });

  /* The Settings editors' save, as server/index.mjs does it minus the ledger and logos. */
  app.post("/profile", guardSave(async (/** @type {any} */ req, /** @type {any} */ res) => {
    if (!isRecord(req.body)) {
      return res.status(400).json({ ok: false, reason: "invalid_profile", errors: [{ message: "Request body must be a JSON object" }] });
    }
    const prior = await readProfile({ path: paths.profile });
    const candidate = carryForwardContact(req.body, prior.ok ? prior.profile : null);
    try {
      const { updatedAt } = await writeProfileAtomic(candidate, { path: paths.profile });
      return res.json({ ok: true, updatedAt, ledger: { ok: false, fixtureMock: true }, logoRefresh: { ok: true, fixtureMock: true } });
    } catch (err) {
      const error = /** @type {Record<string, unknown>} */ (err);
      if (error && error.code === "invalid_profile") {
        return res.status(400).json({ ok: false, reason: "invalid_profile", errors: error.errors || [] });
      }
      return res.status(500).json({ ok: false, reason: "write_failed" });
    }
  }));

  app.post("/profile/contact", guardSave(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = isRecord(req.body) ? req.body : {};
    const contact = normalizeContact(isRecord(body.identity) ? body.identity : body);
    const current = await readProfile({ path: paths.profile });
    if (!current.ok) {
      return res.status(409).json({ ok: false, reason: current.reason === "no_profile" ? "no_profile" : "profile_unreadable", contact });
    }
    const next = withContact(/** @type {Record<string, unknown>} */ (current.profile), contact);
    const { updatedAt } = await writeProfileAtomic(next, { path: paths.profile });
    return res.json({ ok: true, updatedAt, contact: contactOf(/** @type {any} */ (next).identity) });
  }));

  app.put("/profile/resume", guardSave(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const checked = validateResumeSync(req.body);
    if (!checked.ok) return res.status(checked.status).json({ ok: false, reason: checked.reason, message: checked.message });
    const { savedAt } = await writeCanonicalResume(checked.text, { path: paths.resume });
    return res.json({ ok: true, chars: checked.text.length, savedAt });
  }));

  app.get("/profile/resume/read", async (/** @type {any} */ _req, /** @type {any} */ res) =>
    res.json({
      ok: true,
      read: await currentResumeRead({
        readSaved: readSavedResumeText,
        readSavedRead: (text) => readSavedResumeRead(text, { path: paths.read }),
      }),
    }),
  );

  app.get("/profile/voice", async (/** @type {any} */ _req, /** @type {any} */ res) =>
    res.json({ ok: true, ...(await readVoice({ path: paths.voice })) }),
  );
  app.put("/profile/voice", guardSave(async (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = isRecord(req.body) ? req.body : {};
    /** @type {{ ifUpdatedAt?: string | null, path: string }} */
    const options = { path: paths.voice };
    if (Object.prototype.hasOwnProperty.call(body, "ifUpdatedAt")) {
      options.ifUpdatedAt = typeof body.ifUpdatedAt === "string" ? body.ifUpdatedAt : null;
    }
    try {
      return res.json({ ok: true, ...(await saveVoice(body.text, options)) });
    } catch (err) {
      if (isVoiceError(err)) return res.status(err.status).json({ ok: false, reason: err.reason, message: err.message, ...err.extra });
      return res.status(500).json({ ok: false, reason: "write_failed" });
    }
  }));
  app.delete("/profile/voice", guardSave(async (/** @type {any} */ _req, /** @type {any} */ res) => {
    try {
      return res.json({ ok: true, ...(await removeVoice({ path: paths.voice })) });
    } catch (err) {
      if (isVoiceError(err)) return res.status(err.status).json({ ok: false, reason: err.reason, message: err.message, ...err.extra });
      return res.status(500).json({ ok: false, reason: "write_failed" });
    }
  }));

  app.post("/profile/template/:id", (/** @type {any} */ req, /** @type {any} */ res) => {
    const template = buildStarterTemplate(String(req.params.id || ""));
    if (!template) return res.status(404).json({ ok: false, reason: "unknown_template", available: listStarterTemplateIds() });
    return res.json({ ok: true, template });
  });

  app.get("/profile/ledger", (/** @type {any} */ _req, /** @type {any} */ res) =>
    res.status(404).json({ ok: false, reason: "no_ledger", fixtureMock: true }),
  );

  app.get("/api/applications/queue", async (/** @type {any} */ _req, /** @type {any} */ res) =>
    res.json({ queue: await listPendingQueue({ root: paths.applications }) }),
  );
  app.get("/api/applications", (/** @type {any} */ _req, /** @type {any} */ res) =>
    res.json({ ok: true, applications: [], fixtureMock: true }),
  );

  /* MOCK LLM settings store: in memory, and it never echoes a key back. */
  /** @type {{ provider: string, model: string, baseUrl: string, hasApiKey: boolean, judge?: unknown } | null} */
  let llmPin = null;
  app.get("/api/llm-config", (/** @type {any} */ _req, /** @type {any} */ res) => {
    if (!llmPin) return res.status(404).json({ error: "No LLM pin configured.", code: "llm_unconfigured", fixtureMock: true });
    return res.json({ ...llmPin, fixtureMock: true });
  });
  app.post("/api/llm-config", (/** @type {any} */ req, /** @type {any} */ res) => {
    const body = isRecord(req.body) ? req.body : {};
    const provider = typeof body.provider === "string" ? body.provider : llmPin ? llmPin.provider : "";
    const model = typeof body.model === "string" ? body.model : llmPin ? llmPin.model : "";
    llmPin = {
      provider,
      model,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
      hasApiKey: typeof body.apiKey === "string" ? body.apiKey.length > 0 : Boolean(llmPin && llmPin.hasApiKey),
      ...(body.judge !== undefined ? { judge: body.judge } : llmPin && llmPin.judge ? { judge: llmPin.judge } : {}),
    };
    return res.json({ ok: true, ...llmPin, fixtureMock: true });
  });
  app.post("/api/llm-config/judge-models", (/** @type {any} */ _req, /** @type {any} */ res) =>
    res.json({ ok: true, models: [{ id: "fixture-judge-model", label: "Fixture judge (mock)" }], fixtureMock: true }),
  );
  app.post("/api/llm-config/judge-test", (/** @type {any} */ _req, /** @type {any} */ res) =>
    res.json({ ok: true, structured: true, provider: "fixture-mock", model: "fixture-judge-model", ms: 5, fixtureMock: true }),
  );
  app.post("/api/leads/chat", (/** @type {any} */ _req, /** @type {any} */ res) =>
    res.status(503).json({ ok: false, code: "agent_not_connected", error: "Chat is unavailable in the JOBQA fixture.", fixtureMock: true }),
  );

  app.use((/** @type {any} */ req, /** @type {any} */ res) => {
    log({ kind: "unknown_route", method: req.method, path: req.path });
    res.status(404).json({ ok: false, reason: "fixture_unknown_route", path: req.path });
  });
  return app;
}
