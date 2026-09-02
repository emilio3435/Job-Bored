# Standalone Materials Drafter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kanban New → Researching produces a tailored resume and cover letter on the local scraper server, using the one model chosen at setup, with no Hermes binary.

**Architecture:** Setup/Settings persist a single pin to `~/.jobbored/llm.json`. Every owned LLM call (dashboard BYOK, ATS, profile extract/rescore, materials Writer/Editor, discovery Gemini + matcher) reads that pin. `gemini-flash` resolves at call time to the newest stable Flash. The materials path is an in-process FIFO: JD gate → Writer JSON → Cheerio Composer → Critic → Editor (max 2) → HTML/PDF under `~/.jobbored/applications/<slug>/`.

**Tech Stack:** Node 24 ESM (`server/*.mjs`), Express on `:3847`, Cheerio, `node:test` + `node:assert/strict`, browser classic-globals (not ES modules). Discovery worker is TypeScript ESM with `.ts` import extensions.

**Spec:** `docs/superpowers/specs/2026-08-31-standalone-materials-drafter-design.md`

## Global Constraints

- Node 24, npm 11. Test runner is `node:test`; root tests run via `npm test -- tests/<file>.test.mjs`. Discovery tests: `node --experimental-strip-types --test <file>`.
- Work only on `feat/standalone-materials-drafter`. Do not edit other in-flight branches.
- No live provider HTTP in CI. Inject `fetchImpl` / fixtures. Never log `apiKey`.
- `llm.json` mode `0600`. Missing pin fails loud. No silent fallback to `ATS_GEMINI_MODEL` or `BROWSER_USE_DISCOVERY_GEMINI_MODEL` once the file exists.
- `gemini-flash` family: newest stable Flash that is not lite, not preview, not image, not live. List-call fallback: `gemini-3.7-flash`.
- Weak-model warning exact copy: `This model is too weak for tailored letters. Use Gemini Flash unless you are only testing.`
- Cheerio never edits `<style>`, never adds sections, never invents `data-role` values.
- Do not spawn `materials-request.sh`. Do not talk to Telegram. `which hermes` may fail.
- Browser Use Cloud, SerpApi, ATS board scrapes, and Cheerio scrapes are not this pin.
- If the pin is not Gemini, discovery `google_search` / `url_context` skip. Do not keep a leftover 3.5-flash for them.

## File map

| File | Responsibility |
|---|---|
| `server/model-family.mjs` | Pure `gemini-flash` resolver |
| `server/llm-config.mjs` | `~/.jobbored/llm.json` read/write/migrate/redact + `resolveActivePin` |
| `server/index.mjs` | `GET`/`POST /api/llm-config`; materials request enqueues drafter |
| `server/application-materials.mjs` | Root `~/.jobbored/applications`; Hermes copy-on-empty |
| `server/materials-jd-gate.mjs` | Usable-JD heuristic + scrape trigger |
| `server/materials-composer.mjs` | Cheerio slot fill |
| `server/materials-critic.mjs` | Quality wrap + keywords/echo/filler/frozen/html-in-slot |
| `server/materials-writer.mjs` | Writer + Editor LLM JSON (injected fetch) |
| `server/materials-drafter.mjs` | FIFO loop, pending.json, READY/REVIEW |
| `server/materials-request.mjs` | Stop Hermes spawn; call drafter enqueue |
| `server/ats-scorecard.mjs`, `profile-from-resume.mjs`, `profile-rescore-worker.mjs` | Read `llm.json` |
| `integrations/browser-use-discovery/src/config.ts` | `geminiModel`/`llmModel` from `llm.json` |
| `model-catalog.js` | `gemini-flash` first; `isWeakMaterialsModel` |
| `first-run-wizard.js`, `settings-modal.js` | POST pin; weak warning; Gemini default |
| `resume-generate.js`, `discovery-drawer.js`, `job-posting-insights.js` | Active pin, not a second default |
| `config.example.js` | Recommended Gemini + `gemini-flash` |
| `role-materials.js` | Toast only when request is accepted (non-2xx already fails) |

---

### Task 1: Gemini Flash family resolver

**Files:**
- Create: `server/model-family.mjs`
- Test: `tests/model-family.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function isGeminiFlashFamily(model: string): boolean`; `export function pickStableGeminiFlash(modelIds: string[]): string | null`; `export const GEMINI_FLASH_FAMILY = "gemini-flash"`; `export const GEMINI_FLASH_FALLBACK = "gemini-3.7-flash"`; `export function isWeakMaterialsModel(model: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/model-family.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pickStableGeminiFlash,
  isGeminiFlashFamily,
  isWeakMaterialsModel,
  GEMINI_FLASH_FALLBACK,
} from "../server/model-family.mjs";

describe("pickStableGeminiFlash", () => {
  it("picks newest stable flash and skips lite/preview/image/live", () => {
    const picked = pickStableGeminiFlash([
      "gemini-3.5-flash",
      "gemini-3.6-flash",
      "gemini-3.7-flash",
      "gemini-3.7-flash-preview",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-live",
      "gemini-3.7-pro",
    ]);
    assert.equal(picked, "gemini-3.7-flash");
  });

  it("returns null on an empty list so callers can use GEMINI_FLASH_FALLBACK", () => {
    assert.equal(pickStableGeminiFlash([]), null);
    assert.equal(GEMINI_FLASH_FALLBACK, "gemini-3.7-flash");
  });
});

describe("isGeminiFlashFamily", () => {
  it("treats the alias as a family, not a snapshot", () => {
    assert.equal(isGeminiFlashFamily("gemini-flash"), true);
    assert.equal(isGeminiFlashFamily("gemini-3.7-flash"), false);
  });
});

describe("isWeakMaterialsModel", () => {
  it("flags OpenRouter free OSS ids", () => {
    assert.equal(isWeakMaterialsModel("openai/gpt-oss-120b:free"), true);
    assert.equal(isWeakMaterialsModel("openai/gpt-oss-20b:free"), true);
    assert.equal(isWeakMaterialsModel("gemini-flash"), false);
    assert.equal(isWeakMaterialsModel("gemini-3.7-flash"), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/model-family.test.mjs`

Expected: FAIL with `Cannot find module` / `ERR_MODULE_NOT_FOUND` for `server/model-family.mjs`.

- [ ] **Step 3: Write minimal implementation**

Create `server/model-family.mjs`:

```js
export const GEMINI_FLASH_FAMILY = "gemini-flash";
export const GEMINI_FLASH_FALLBACK = "gemini-3.7-flash";

const WEAK_EXACT = new Set([
  "openai/gpt-oss-120b:free",
  "openai/gpt-oss-20b:free",
]);

export function isGeminiFlashFamily(model) {
  return String(model || "").trim() === GEMINI_FLASH_FAMILY;
}

export function isWeakMaterialsModel(model) {
  const id = String(model || "").trim().toLowerCase();
  if (!id) return false;
  if (WEAK_EXACT.has(id)) return true;
  return id.endsWith(":free");
}

function parseFlashVersion(id) {
  const m = String(id || "").trim().match(/^gemini-(\d+)(?:\.(\d+))?-flash$/i);
  if (!m) return null;
  return { major: Number(m[1]), minor: m[2] ? Number(m[2]) : 0 };
}

export function pickStableGeminiFlash(modelIds) {
  let best = null;
  let bestKey = null;
  for (const raw of Array.isArray(modelIds) ? modelIds : []) {
    const id = String(raw || "").replace(/^models\//, "").trim();
    const parsed = parseFlashVersion(id);
    if (!parsed) continue;
    const key = parsed.major * 1000 + parsed.minor;
    if (bestKey === null || key > bestKey) {
      bestKey = key;
      best = id;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/model-family.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/model-family.mjs tests/model-family.test.mjs
git commit -m "feat: resolve gemini-flash to newest stable Flash"
```

---

### Task 2: `llm.json` pin store

**Files:**
- Create: `server/llm-config.mjs`
- Test: `tests/llm-config.test.mjs`

**Interfaces:**
- Consumes: `isGeminiFlashFamily`, `pickStableGeminiFlash`, `GEMINI_FLASH_FALLBACK` from `server/model-family.mjs`.
- Produces: `export function llmConfigPath(env?: NodeJS.ProcessEnv): string`; `export function loadLlmConfig(env?: NodeJS.ProcessEnv): LlmConfig | null`; `export async function writeLlmConfig(config, env?: NodeJS.ProcessEnv): Promise<LlmConfig>`; `export function migrateLlmConfigFromEnv(env?: NodeJS.ProcessEnv): LlmConfig | null`; `export function redactLlmConfig(config): { provider, model, baseUrl, keyPresent, updatedAt }`; `export async function resolveActivePin(config, options?: { fetchImpl?, listGeminiModels? }): Promise<{ provider, model, apiKey, baseUrl, resolvedModel }>`; type `LlmConfig = { provider: string, model: string, apiKey: string, baseUrl: string, updatedAt: string }`.

`llmConfigPath` is `join(homedir(), ".jobbored", "llm.json")` unless `JOBBORED_LLM_CONFIG_PATH` is set (tests).

- [ ] **Step 1: Write the failing test**

Create `tests/llm-config.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, readFile, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  llmConfigPath,
  loadLlmConfig,
  writeLlmConfig,
  migrateLlmConfigFromEnv,
  redactLlmConfig,
  resolveActivePin,
} from "../server/llm-config.mjs";

let dir;
let env;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jb-llm-"));
  env = { JOBBORED_LLM_CONFIG_PATH: join(dir, "llm.json") };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("llm.json", () => {
  it("returns null when missing", () => {
    assert.equal(loadLlmConfig(env), null);
  });

  it("writes mode 0600 and round-trips without logging the key", async () => {
    await writeLlmConfig(
      { provider: "gemini", model: "gemini-flash", apiKey: "secret-key", baseUrl: "" },
      env,
    );
    const mode = (await stat(env.JOBBORED_LLM_CONFIG_PATH)).mode & 0o777;
    assert.equal(mode, 0o600);
    const loaded = loadLlmConfig(env);
    assert.equal(loaded.apiKey, "secret-key");
    const redacted = redactLlmConfig(loaded);
    assert.equal(redacted.keyPresent, true);
    assert.equal("apiKey" in redacted, false);
    const raw = await readFile(env.JOBBORED_LLM_CONFIG_PATH, "utf8");
    assert.match(raw, /secret-key/);
  });

  it("migrates ATS env once when llm.json is missing", () => {
    const migrated = migrateLlmConfigFromEnv({
      ...env,
      ATS_PROVIDER: "gemini",
      ATS_GEMINI_API_KEY: "from-env",
      ATS_GEMINI_MODEL: "gemini-2.5-flash",
    });
    assert.equal(migrated.provider, "gemini");
    assert.equal(migrated.model, "gemini-2.5-flash");
    assert.equal(migrated.apiKey, "from-env");
    const again = migrateLlmConfigFromEnv({
      ...env,
      ATS_GEMINI_API_KEY: "ignored",
      ATS_GEMINI_MODEL: "gemini-2.5-flash",
    });
    assert.equal(again.apiKey, "from-env");
  });

  it("ignores ATS_GEMINI_MODEL once llm.json exists", async () => {
    await writeLlmConfig(
      { provider: "gemini", model: "gemini-flash", apiKey: "pin-key", baseUrl: "" },
      env,
    );
    const loaded = loadLlmConfig({
      ...env,
      ATS_GEMINI_MODEL: "gemini-2.5-flash",
      ATS_GEMINI_API_KEY: "env-key",
    });
    assert.equal(loaded.model, "gemini-flash");
    assert.equal(loaded.apiKey, "pin-key");
  });
});

describe("resolveActivePin", () => {
  it("resolves gemini-flash via injected list", async () => {
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      { listGeminiModels: async () => ["gemini-3.5-flash", "gemini-3.7-flash", "gemini-3.7-flash-preview"] },
    );
    assert.equal(pin.resolvedModel, "gemini-3.7-flash");
    assert.equal(pin.model, "gemini-flash");
  });

  it("falls back to gemini-3.7-flash when the list is empty", async () => {
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      { listGeminiModels: async () => [] },
    );
    assert.equal(pin.resolvedModel, "gemini-3.7-flash");
  });

  it("keeps an exact snapshot id", async () => {
    const pin = await resolveActivePin(
      { provider: "gemini", model: "gemini-3.7-flash", apiKey: "k", baseUrl: "", updatedAt: "" },
      { listGeminiModels: async () => ["gemini-3.8-flash"] },
    );
    assert.equal(pin.resolvedModel, "gemini-3.7-flash");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/llm-config.test.mjs`

Expected: FAIL `ERR_MODULE_NOT_FOUND` for `server/llm-config.mjs`.

- [ ] **Step 3: Write minimal implementation**

Create `server/llm-config.mjs` that:
- Resolves path from `env.JOBBORED_LLM_CONFIG_PATH` or `join(homedir(), ".jobbored", "llm.json")`.
- `loadLlmConfig` uses `readFileSync` + `JSON.parse`; returns null on missing/invalid.
- `writeLlmConfig` `mkdir` parent, writes JSON, `chmod 0o600`.
- `migrateLlmConfigFromEnv` no-ops if file exists; else copies `ATS_PROVIDER` / `ATS_GEMINI_*` (and OpenAI/Anthropic/OpenRouter siblings if provider matches) into a new file.
- `redactLlmConfig` returns `{ provider, model, baseUrl, keyPresent: Boolean(apiKey), updatedAt }` and never includes `apiKey`.
- `resolveActivePin` if `isGeminiFlashFamily(config.model)` then `pickStableGeminiFlash(await listGeminiModels()) || GEMINI_FLASH_FALLBACK`; else `resolvedModel = config.model`.

Do not `console.log` the apiKey. If you log, log `redactLlmConfig(config)` only.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/llm-config.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/llm-config.mjs tests/llm-config.test.mjs
git commit -m "feat: persist the one LLM pin in llm.json"
```

---

### Task 3: `/api/llm-config` + Settings/first-run write the pin

**Files:**
- Modify: `server/index.mjs` (add GET/POST next to other `/api/` routes)
- Modify: `settings-modal.js` (on save, POST the active provider/model/key)
- Modify: `first-run-wizard.js` (same POST when the AI step saves; show weak-model warning)
- Modify: `model-catalog.js` (put `{ value: "gemini-flash", label: "Gemini Flash (latest)" }` first in Gemini static list; re-export `isWeakMaterialsModel` on `window.JobBoredModelCatalog`)
- Modify: `config.example.js` (`resumeProvider: "gemini"`, `resumeGeminiModel: "gemini-flash"`)
- Test: `tests/llm-config-endpoint.test.mjs`
- Test: `tests/first-run-wizard-provider-picker.test.mjs` (extend) and/or new `tests/weak-materials-model-warning.test.mjs`

**Interfaces:**
- Consumes: `loadLlmConfig`, `writeLlmConfig`, `redactLlmConfig` from `server/llm-config.mjs`; `isWeakMaterialsModel` from `server/model-family.mjs` (server) and `JobBoredModelCatalog.isWeakMaterialsModel` (browser).
- Produces: `GET /api/llm-config` → 200 `{ provider, model, baseUrl, keyPresent, updatedAt }` or 404 `{ error, code: "llm_unconfigured" }`; `POST /api/llm-config` body `{ provider, model, apiKey, baseUrl }` → 200 redacted pin.

- [ ] **Step 1: Write the failing endpoint test**

Create `tests/llm-config-endpoint.test.mjs` following the pattern in `tests/materials-request-endpoint.test.mjs` (import the handlers if they are exported; if not, export `handleGetLlmConfig` / `handlePostLlmConfig` from a tiny `server/llm-config-http.mjs` so tests do not boot Express).

Preferred: put the HTTP handlers in `server/llm-config.mjs`:

```js
export async function handleGetLlmConfig(req, res, env = process.env) {
  const loaded = loadLlmConfig(env);
  if (!loaded) {
    res.status(404).json({ error: "No LLM pin configured.", code: "llm_unconfigured" });
    return;
  }
  res.json(redactLlmConfig(loaded));
}

export async function handlePostLlmConfig(req, res, env = process.env) {
  const body = req.body || {};
  const provider = String(body.provider || "").trim();
  const model = String(body.model || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  const baseUrl = String(body.baseUrl || "").trim();
  if (!provider || !model) {
    res.status(400).json({ error: "provider and model are required.", code: "llm_invalid" });
    return;
  }
  const saved = await writeLlmConfig({ provider, model, apiKey, baseUrl }, env);
  res.json(redactLlmConfig(saved));
}
```

Test: POST then GET with `JOBBORED_LLM_CONFIG_PATH` in a temp dir. Assert GET never contains `apiKey`. Assert POST 400 when model missing.

For the warning, create `tests/weak-materials-model-warning.test.mjs` that loads `model-catalog.js` in a vm (copy the loader from `tests/model-catalog.test.mjs`) and asserts `api.isWeakMaterialsModel("openai/gpt-oss-120b:free") === true`. Then grep `first-run-wizard.js` for the exact warning string in a second test that reads the file:

```js
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("first-run weak model copy", () => {
  it("uses the spec warning string", () => {
    const src = readFileSync(new URL("../first-run-wizard.js", import.meta.url), "utf8");
    assert.match(
      src,
      /This model is too weak for tailored letters\. Use Gemini Flash unless you are only testing\./,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/llm-config-endpoint.test.mjs tests/weak-materials-model-warning.test.mjs`

Expected: FAIL (missing handlers / missing warning string).

- [ ] **Step 3: Implement**

1. Add the handlers to `server/llm-config.mjs` as above.
2. In `server/index.mjs`:

```js
import { handleGetLlmConfig, handlePostLlmConfig } from "./llm-config.mjs";

app.get("/api/llm-config", (req, res) => handleGetLlmConfig(req, res));
app.post("/api/llm-config", (req, res) => handlePostLlmConfig(req, res));
```

3. `model-catalog.js`: prepend Gemini option `{ value: "gemini-flash", label: "Gemini Flash (latest)", description: "Newest stable Flash. Resolves at call time." }`. Attach `isWeakMaterialsModel` (same rules as server: `:free` suffix or the two gpt-oss ids). Keep the function duplicated in the IIFE; do not import ESM into the browser file.
4. `config.example.js`: `resumeProvider: "gemini"`, `resumeGeminiModel: "gemini-flash"`. Leave OpenRouter fields present but not the default.
5. `settings-modal.js`: after a successful settings save, `fetch(jobBoredApiUrl + "/api/llm-config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model, apiKey, baseUrl }) })`. Use the selected provider's key/model only.
6. `first-run-wizard.js`: same POST when the AI provider step is saved. Before continue, if `JobBoredModelCatalog.isWeakMaterialsModel(model)` show the spec warning; Continue still allowed.
7. Update any first-run test that asserts the shipped default is OpenRouter **as the config.example default** (not tests that simulate a user picking OpenRouter). `tests/settings-fit-profile-and-gemini-models.test.mjs` expected values must include `gemini-flash`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/llm-config-endpoint.test.mjs tests/weak-materials-model-warning.test.mjs tests/model-catalog.test.mjs tests/settings-fit-profile-and-gemini-models.test.mjs tests/first-run-wizard-provider-picker.test.mjs`

Expected: PASS. Fix any default-id assertions that still expect `gemini-3.5-flash` as the first Gemini option.

- [ ] **Step 5: Commit**

```bash
git add server/llm-config.mjs server/index.mjs model-catalog.js config.example.js settings-modal.js first-run-wizard.js tests/llm-config-endpoint.test.mjs tests/weak-materials-model-warning.test.mjs tests/model-catalog.test.mjs tests/settings-fit-profile-and-gemini-models.test.mjs tests/first-run-wizard-provider-picker.test.mjs
git commit -m "feat: save the setup model pin through /api/llm-config"
```

---

### Task 4: ATS, profile, and browser calls use the pin

**Files:**
- Modify: `server/ats-scorecard.mjs` (`getProviderConfigFromEnv` / `getAtsConfigStatus` / `analyzeAtsScorecard`)
- Modify: `server/profile-from-resume.mjs`
- Modify: `server/profile-rescore-worker.mjs`
- Modify: `resume-generate.js` (Gemini/OpenAI/Anthropic fallbacks)
- Modify: `discovery-drawer.js` (`resolveGeminiModel` fallback)
- Modify: `job-posting-insights.js` (Gemini fallback)
- Test: `tests/ats-scorecard-provider.test.mjs` (extend)
- Test: `tests/llm-pin-consumers.test.mjs` (new file-source assertions + ATS config)

**Interfaces:**
- Consumes: `loadLlmConfig`, `migrateLlmConfigFromEnv`, `resolveActivePin` from `server/llm-config.mjs`.
- Produces: `getAtsConfigStatus()` is `configured: false` with reason from missing `llm.json` when no pin and no migratable env; when `llm.json` exists, ATS uses `pin.provider` / `pin.resolvedModel` / `pin.apiKey` and ignores `ATS_GEMINI_MODEL`.

- [ ] **Step 1: Write the failing test**

Create `tests/llm-pin-consumers.test.mjs`:

```js
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLlmConfig } from "../server/llm-config.mjs";
import { getAtsConfigStatus } from "../server/ats-scorecard.mjs";
import { readFileSync } from "node:fs";

describe("ATS respects llm.json over ATS_GEMINI_MODEL", () => {
  let dir;
  const prevPath = process.env.JOBBORED_LLM_CONFIG_PATH;
  const prevModel = process.env.ATS_GEMINI_MODEL;
  const prevKey = process.env.ATS_GEMINI_API_KEY;
  const prevProvider = process.env.ATS_PROVIDER;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-ats-pin-"));
    process.env.JOBBORED_LLM_CONFIG_PATH = join(dir, "llm.json");
    process.env.ATS_PROVIDER = "gemini";
    process.env.ATS_GEMINI_MODEL = "gemini-2.5-flash";
    process.env.ATS_GEMINI_API_KEY = "env-key";
    await writeLlmConfig(
      { provider: "gemini", model: "gemini-3.7-flash", apiKey: "pin-key", baseUrl: "" },
      process.env,
    );
  });

  afterEach(async () => {
    if (prevPath === undefined) delete process.env.JOBBORED_LLM_CONFIG_PATH;
    else process.env.JOBBORED_LLM_CONFIG_PATH = prevPath;
    process.env.ATS_GEMINI_MODEL = prevModel;
    process.env.ATS_GEMINI_API_KEY = prevKey;
    process.env.ATS_PROVIDER = prevProvider;
    await rm(dir, { recursive: true, force: true });
  });

  it("is configured from the pin, not 2.5-flash env", () => {
    const status = getAtsConfigStatus();
    assert.equal(status.configured, true);
    assert.equal(status.provider, "gemini");
    assert.notEqual(status.model, "gemini-2.5-flash");
  });
});

describe("browser fallbacks no longer hardcode 3.5-flash as the product default", () => {
  it("resume-generate.js default Gemini id is gemini-flash", () => {
    const src = readFileSync(new URL("../resume-generate.js", import.meta.url), "utf8");
    assert.match(src, /gemini-flash/);
    assert.doesNotMatch(
      src,
      /resumeGeminiModel \|\| "gemini-3\.5-flash"/,
    );
  });
});
```

`getAtsConfigStatus` today does not return `model`. Extend it to `{ configured, provider, model, reason }` where `model` is the unresolved pin model (family alias allowed). Tests need that field.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/llm-pin-consumers.test.mjs`

Expected: FAIL (`status.model` undefined and/or still 3.5 fallbacks in `resume-generate.js`).

- [ ] **Step 3: Implement**

In `server/ats-scorecard.mjs`:
- At the top of `getProviderConfigFromEnv` (or a new `getProviderConfig()` used by both status and analyze): `migrateLlmConfigFromEnv(process.env)` then `loadLlmConfig(process.env)`.
- If loaded, map `provider/model/apiKey/baseUrl` onto the existing cfg object. Do not read `ATS_GEMINI_MODEL` when loaded is non-null.
- If not loaded and no migratable env, `configured: false`, reason `"No LLM pin configured. Save an AI provider in Settings."`.
- `analyzeAtsScorecard` uses `await resolveActivePin(loaded)` for the actual model id.

Same pattern in `profile-from-resume.mjs` and `profile-rescore-worker.mjs`.

Browser:
- `resume-generate.js` defaults: `resumeGeminiModel || "gemini-flash"` (not 3.5). Same for `CommandCenterResumeModelOptions` Gemini list (alias first).
- `discovery-drawer.js` `resolveGeminiModel` last fallback: `"gemini-flash"`.
- `job-posting-insights.js` same.

Update `probes/probe-config-defaults.mjs` and `probes/probe-profile-aware-scorer.mjs` in Task 5 (discovery), not here.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/llm-pin-consumers.test.mjs tests/ats-scorecard-provider.test.mjs`

Expected: PASS. Update `tests/ats-scorecard-provider.test.mjs` if it stubs only env keys; give it `JOBBORED_LLM_CONFIG_PATH` in a temp file or keep env-migrate behavior (env migrate is allowed when file is missing).

- [ ] **Step 5: Commit**

```bash
git add server/ats-scorecard.mjs server/profile-from-resume.mjs server/profile-rescore-worker.mjs resume-generate.js discovery-drawer.js job-posting-insights.js tests/llm-pin-consumers.test.mjs tests/ats-scorecard-provider.test.mjs
git commit -m "feat: route ATS and dashboard LLM calls through llm.json"
```

---

### Task 5: Discovery worker reads the same pin

**Files:**
- Modify: `integrations/browser-use-discovery/src/config.ts`
- Modify: `probes/probe-config-defaults.mjs`
- Modify: `probes/probe-profile-aware-scorer.mjs`
- Test: `integrations/browser-use-discovery/tests/config-llm-pin.test.ts`

**Interfaces:**
- Consumes: `loadLlmConfig`, `migrateLlmConfigFromEnv` from `../../../server/llm-config.mjs`.
- Produces: `loadRuntimeConfig(env)` sets `geminiModel` / `llmModel` / `llmProvider` / `llmApiKey` from `llm.json` when present; `BROWSER_USE_DISCOVERY_GEMINI_MODEL` is ignored then. If pin provider is not `gemini`, `geminiApiKey` stays empty so `google_search` / `url_context` skip.

- [ ] **Step 1: Write the failing test**

Create `integrations/browser-use-discovery/tests/config-llm-pin.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRuntimeConfig } from "../src/config.ts";

test("llm.json wins over BROWSER_USE_DISCOVERY_GEMINI_MODEL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jb-disc-pin-"));
  const path = join(dir, "llm.json");
  await writeFile(
    path,
    JSON.stringify({
      provider: "gemini",
      model: "gemini-3.7-flash",
      apiKey: "pin-key",
      baseUrl: "",
      updatedAt: "2026-08-31T00:00:00Z",
    }),
  );
  try {
    const cfg = loadRuntimeConfig({
      JOBBORED_LLM_CONFIG_PATH: path,
      BROWSER_USE_DISCOVERY_GEMINI_MODEL: "gemini-3.5-flash",
      BROWSER_USE_DISCOVERY_GEMINI_API_KEY: "env-key",
    });
    assert.equal(cfg.geminiModel, "gemini-3.7-flash");
    assert.equal(cfg.geminiApiKey, "pin-key");
    assert.equal(cfg.llmProvider, "gemini");
    assert.equal(cfg.llmModel, "gemini-3.7-flash");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("non-Gemini pin leaves google_search key empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jb-disc-pin-"));
  const path = join(dir, "llm.json");
  await writeFile(
    path,
    JSON.stringify({
      provider: "openai",
      model: "gpt-5.6-terra",
      apiKey: "sk-test",
      baseUrl: "",
      updatedAt: "2026-08-31T00:00:00Z",
    }),
  );
  try {
    const cfg = loadRuntimeConfig({
      JOBBORED_LLM_CONFIG_PATH: path,
      BROWSER_USE_DISCOVERY_GEMINI_MODEL: "gemini-3.5-flash",
      BROWSER_USE_DISCOVERY_GEMINI_API_KEY: "env-gemini",
    });
    assert.equal(cfg.llmProvider, "openai");
    assert.equal(cfg.llmModel, "gpt-5.6-terra");
    assert.equal(cfg.geminiApiKey, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test integrations/browser-use-discovery/tests/config-llm-pin.test.ts`

Expected: FAIL (`geminiModel` still `gemini-3.5-flash`).

- [ ] **Step 3: Implement**

In `loadRuntimeConfig` after env reads, call `migrateLlmConfigFromEnv(runtimeEnv)` then `loadLlmConfig(runtimeEnv)`.

If loaded:
- `llmProvider = loaded.provider`
- `llmModel = loaded.model` (family alias is OK here; `resolveActivePin` at call sites that hit Gemini HTTP should resolve — for v1, if `loaded.model === "gemini-flash"`, set both `llmModel` and `geminiModel` to `GEMINI_FLASH_FALLBACK` unless a list function is injected. Discovery `loadRuntimeConfig` is sync, so do **not** call the live Gemini list here. Use `gemini-3.7-flash` when the stored model is `gemini-flash`.)
- If `loaded.provider === "gemini"`: `geminiApiKey = loaded.apiKey`, `geminiModel = resolved snapshot`.
- Else: `geminiApiKey = ""` (skip Google tools). Do not copy `BROWSER_USE_DISCOVERY_GEMINI_API_KEY`.

Update probes:

```js
const expected = "gemini-3.7-flash";
```

in `probes/probe-config-defaults.mjs` and `probes/probe-profile-aware-scorer.mjs`.

- [ ] **Step 4: Run tests**

Run: `node --experimental-strip-types --test integrations/browser-use-discovery/tests/config-llm-pin.test.ts`

Then: `node --experimental-strip-types probes/probe-config-defaults.mjs`

Expected: PASS / `PROBE_CONFIG_geminiModel: gemini-3.7-flash` when env is empty (no llm.json). Empty env default should also become `gemini-3.7-flash` instead of `gemini-3.5-flash` in `config.ts` (`|| "gemini-3.7-flash"`).

- [ ] **Step 5: Commit**

```bash
git add integrations/browser-use-discovery/src/config.ts integrations/browser-use-discovery/tests/config-llm-pin.test.ts probes/probe-config-defaults.mjs probes/probe-profile-aware-scorer.mjs
git commit -m "feat: discovery Gemini and matcher follow llm.json"
```

---

### Task 6: Application package root + Hermes copy

**Files:**
- Modify: `server/application-materials.mjs` (`getApplicationsRoot`, add migrate helper)
- Test: `tests/application-materials-root.test.mjs` (new or extend existing materials tests)

**Interfaces:**
- Consumes: `homedir`, `existsSync`, `cp`/`readdir`.
- Produces: `export function getApplicationsRoot(env = process.env): string` prefers `JOBBORED_APPLICATIONS_ROOT`, else `join(homedir(), ".jobbored", "applications")`. `HERMES_APPLICATIONS_ROOT` is test-only alias if `JOBBORED_APPLICATIONS_ROOT` is unset (keep existing tests working by treating `HERMES_APPLICATIONS_ROOT` as the override when the new var is absent). `export async function migrateHermesApplicationsIfNeeded(env = process.env): Promise<{ copied: number }>` copies `~/.hermes/job-hunt/applications/*` into the new root when the new root is missing or empty.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getApplicationsRoot,
  migrateHermesApplicationsIfNeeded,
} from "../server/application-materials.mjs";

describe("getApplicationsRoot", () => {
  it("prefers JOBBORED_APPLICATIONS_ROOT", () => {
    assert.equal(
      getApplicationsRoot({ JOBBORED_APPLICATIONS_ROOT: "/tmp/jb-apps" }),
      "/tmp/jb-apps",
    );
  });

  it("falls back to HERMES_APPLICATIONS_ROOT for tests", () => {
    assert.equal(
      getApplicationsRoot({ HERMES_APPLICATIONS_ROOT: "/tmp/hermes-apps" }),
      "/tmp/hermes-apps",
    );
  });

  it("defaults under ~/.jobbored/applications", () => {
    const root = getApplicationsRoot({});
    assert.match(root, /\.jobbored\/applications$/);
  });
});

describe("migrateHermesApplicationsIfNeeded", () => {
  it("copies leftover Hermes packages into an empty JobBored root", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-mig-"));
    const hermes = join(dir, "hermes");
    const dest = join(dir, "jobbored");
    await mkdir(join(hermes, "eab-role"), { recursive: true });
    await writeFile(join(hermes, "eab-role", "pending.json"), "{}");
    const result = await migrateHermesApplicationsIfNeeded({
      JOBBORED_APPLICATIONS_ROOT: dest,
      HERMES_APPLICATIONS_LEGACY_ROOT: hermes,
    });
    assert.equal(result.copied, 1);
    assert.equal(await readFile(join(dest, "eab-role", "pending.json"), "utf8"), "{}");
    await rm(dir, { recursive: true, force: true });
  });

  it("does not copy when dest already has a slug", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-mig-"));
    const hermes = join(dir, "hermes");
    const dest = join(dir, "jobbored");
    await mkdir(join(hermes, "eab-role"), { recursive: true });
    await writeFile(join(hermes, "eab-role", "pending.json"), "{}");
    await mkdir(join(dest, "other"), { recursive: true });
    await writeFile(join(dest, "other", "pending.json"), "{}");
    const result = await migrateHermesApplicationsIfNeeded({
      JOBBORED_APPLICATIONS_ROOT: dest,
      HERMES_APPLICATIONS_LEGACY_ROOT: hermes,
    });
    assert.equal(result.copied, 0);
    await rm(dir, { recursive: true, force: true });
  });
});
```

Use `HERMES_APPLICATIONS_LEGACY_ROOT` for the source path so tests do not touch `~/.hermes`. Production default source: `join(homedir(), ".hermes", "job-hunt", "applications")`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/application-materials-root.test.mjs`

Expected: FAIL (`getApplicationsRoot` still returns `~/.hermes/...`).

- [ ] **Step 3: Implement**

Update `getApplicationsRoot` in `server/application-materials.mjs`. Add `migrateHermesApplicationsIfNeeded`. Call it once from `server/index.mjs` at listen time (`void migrateHermesApplicationsIfNeeded()`). Use `cp` recursive from `node:fs/promises`.

Keep `HERMES_APPLICATIONS_ROOT` as override so existing tests that set it still isolate.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/application-materials-root.test.mjs`

Also run any existing `tests/*materials*` files that stub `HERMES_APPLICATIONS_ROOT`.

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/application-materials.mjs server/index.mjs tests/application-materials-root.test.mjs
git commit -m "feat: store application packages under ~/.jobbored"
```

---

### Task 7: JD gate

**Files:**
- Create: `server/materials-jd-gate.mjs`
- Test: `tests/materials-jd-gate.test.mjs`

**Interfaces:**
- Consumes: `scrapeJobPosting` from `server/shared/job-scraper-core.mjs` (injected as `scrapeJob` for tests).
- Produces: `export function isUsableJobDescription(text: string): boolean`; `export async function resolveJobDescription({ cachedText, jobUrl, scrapeJob }): Promise<{ text: string, source: "cache" | "scrape" } | { error: "jd_unusable" }>`.

Unusable when trimmed word count `< 80`, or `/^\s*(low|high|medium)\s+fit\b/i.test(text)`, or `/\b\d+(?:\.\d+)?\s*\/\s*10\b/.test(text)` as the whole short body, or empty while `jobUrl` is present.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUsableJobDescription,
  resolveJobDescription,
} from "../server/materials-jd-gate.mjs";

const EAB_BLURB =
  "Low fit for Senior Director, Digital Marketing Strategy, Advancement — 4.7/10";

describe("isUsableJobDescription", () => {
  it("rejects the EAB fit blurb", () => {
    assert.equal(isUsableJobDescription(EAB_BLURB), false);
  });

  it("rejects short text", () => {
    assert.equal(isUsableJobDescription("A short note."), false);
  });

  it("accepts a real posting", () => {
    const jd = Array(90).fill("responsibility").join(" ");
    assert.equal(isUsableJobDescription(jd), true);
  });
});

describe("resolveJobDescription", () => {
  it("scrapes when cache is junk", async () => {
    const posting = Array(90).fill("requirement").join(" ");
    const result = await resolveJobDescription({
      cachedText: EAB_BLURB,
      jobUrl: "https://www.edtech.com/jobs/example",
      scrapeJob: async () => ({ description: posting }),
    });
    assert.equal(result.source, "scrape");
    assert.equal(isUsableJobDescription(result.text), true);
  });

  it("returns jd_unusable when scrape fails", async () => {
    const result = await resolveJobDescription({
      cachedText: EAB_BLURB,
      jobUrl: "https://www.edtech.com/jobs/example",
      scrapeJob: async () => {
        throw new Error("blocked");
      },
    });
    assert.equal(result.error, "jd_unusable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/materials-jd-gate.test.mjs`

Expected: FAIL module not found.

- [ ] **Step 3: Implement `server/materials-jd-gate.mjs`**

Word count: `text.trim().split(/\s+/).filter(Boolean).length`. If usable cache, `{ text: cachedText, source: "cache" }`. Else scrape `jobUrl`; if scraped description is usable, return it; else `{ error: "jd_unusable" }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/materials-jd-gate.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/materials-jd-gate.mjs tests/materials-jd-gate.test.mjs
git commit -m "feat: reject fit-blurb job descriptions before drafting"
```

---

### Task 8: Composer (Cheerio typesetter)

**Files:**
- Create: `server/materials-composer.mjs`
- Create: `tests/fixtures/materials/mini-letter.html`
- Create: `tests/fixtures/materials/mini-resume.html`
- Test: `tests/materials-composer.test.mjs`

**Interfaces:**
- Consumes: `cheerio`.
- Produces: `export function composeCoverLetter(html: string, letter: LetterJson): string`; `export function composeResume(html: string, resume: ResumeJson): string`.

`LetterJson` keys: `date, company, companyAddr, role, hiringManager, hook, whyThem, whyMe, whyNow, closing, flourish` mapping to `data-slot` names `date, company, company-addr, role, hiring-manager, hook, why-them, why-me, why-now, closing, flourish` (and `salutation-name` ← `hiringManager`).

`ResumeJson`: `{ summary: { opener, body }, roles: [{ id, bullets }] }`. Summary fills `[data-section="summary"]`. Each `roles[].id` fills `article[data-role="<id>"]` list items. Unknown `id` is ignored (do not create nodes).

- [ ] **Step 1: Write fixtures + failing test**

`tests/fixtures/materials/mini-letter.html`:

```html
<!doctype html>
<html><head><style>.keep{color:navy}</style></head>
<body>
  <span data-slot="company">[Company]</span>
  <span data-slot="role">[Role]</span>
  <p data-slot="hook">old hook</p>
  <p data-slot="why-them">old</p>
</body></html>
```

`tests/fixtures/materials/mini-resume.html`:

```html
<!doctype html>
<html><head><style>.keep{color:navy}</style></head>
<body>
  <section data-section="summary"><p>old summary</p></section>
  <article class="role" data-role="audacy-dsm"><ul><li>old bullet</li></ul></article>
</body></html>
```

Test:

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { composeCoverLetter, composeResume } from "../server/materials-composer.mjs";

const letterTpl = readFileSync(new URL("./fixtures/materials/mini-letter.html", import.meta.url), "utf8");
const resumeTpl = readFileSync(new URL("./fixtures/materials/mini-resume.html", import.meta.url), "utf8");

describe("composeCoverLetter", () => {
  it("fills slots and leaves CSS alone", () => {
    const html = composeCoverLetter(letterTpl, {
      company: "EAB",
      role: "Senior Director",
      hook: "I build systems that decide where the next dollar goes.",
      whyThem: "Advancement needs operators who can ship.",
    });
    assert.match(html, /EAB/);
    assert.match(html, /Senior Director/);
    assert.match(html, /\.keep\{color:navy\}/);
    assert.doesNotMatch(html, /\[Company\]/);
  });
});

describe("composeResume", () => {
  it("fills an existing data-role and does not invent roles", () => {
    const html = composeResume(resumeTpl, {
      summary: { opener: "Operator.", body: "Paid media + AI systems." },
      roles: [
        { id: "audacy-dsm", bullets: ["Grew Denver to top-3 nationally."] },
        { id: "does-not-exist", bullets: ["invented"] },
      ],
    });
    assert.match(html, /Grew Denver to top-3 nationally/);
    assert.doesNotMatch(html, /invented/);
    assert.doesNotMatch(html, /data-role="does-not-exist"/);
    assert.match(html, /\.keep\{color:navy\}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/materials-composer.test.mjs`

Expected: FAIL module not found.

- [ ] **Step 3: Implement with Cheerio**

Load HTML, `$(`[data-slot="${slot}"]`).text(value)` for each present letter field. For resume summary, replace inner text of `[data-section="summary"]` (keep the section node). For each known role, replace `ul li` text: if more bullets than `li`, clone the last `li`; if fewer, remove extras. Never call `$.html()` on `<style>` replacements. Return serialized HTML (`$.root().html()` or `$.html()` matching how `job-scraper-core.mjs` serializes).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/materials-composer.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/materials-composer.mjs tests/materials-composer.test.mjs tests/fixtures/materials/mini-letter.html tests/fixtures/materials/mini-resume.html
git commit -m "feat: typeset writer JSON into branded HTML slots"
```

---

### Task 9: Critic extras

**Files:**
- Create: `server/materials-critic.mjs`
- Test: `tests/materials-critic.test.mjs`
- Modify: `server/materials-quality.mjs` only if a helper must be exported (`analyzeHtml` is already exported).

**Interfaces:**
- Consumes: `analyzeHtml`, `auditCoverLetter`, `auditResume` from `server/materials-quality.mjs`.
- Produces: `export function critiqueMaterials({ letterHtml, resumeHtml, jdText, masterResumeHtml, writerJson }): { status: "pass" | "review" | "fail", letter, resume, issues: { code, message, severity }[] }`.

Codes to emit:
- `letter_too_short` / `letter_too_long` from existing 325–475 budgets (reuse `auditCoverLetter` via temp files **or** call `analyzeHtml` and duplicate the word bounds — prefer writing HTML to a temp file and calling `auditCoverLetter({ htmlPath })` so budgets stay single-sourced).
- `keyword_coverage_low` (review) if fewer than 3 JD keywords of length ≥ 5 appear in letter+resume (keywords = JD words length ≥ 5 minus a tiny stop list: `about, their, would, should, other, which`).
- `jd_echo` (review) if any 8-word JD window appears verbatim in the letter.
- `banned_filler` (review) if letter matches `/leverage|synergize|passionate about|results-driven|proven track record/i`.
- `frozen_fact_broken` (fail) if `masterResumeHtml` contains `Audacy` (or extracted employer strings) and the composed resume does not.
- `html_in_slot` (fail) if any writer string contains `<` followed by a letter (`/<[a-z]/i`).

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { critiqueMaterials } from "../server/materials-critic.mjs";

const jd = `${"digital marketing strategy advancement alumni pipeline ".repeat(20)} unique-keyword-xyz`;

function letterOf(words) {
  return `<html><body><article class="page"><p>${Array(words).fill("word").join(" ")}</p></article></body></html>`;
}

describe("critiqueMaterials", () => {
  it("fails a 200-word letter", async () => {
    const out = await critiqueMaterials({
      letterHtml: letterOf(200),
      resumeHtml: "<section data-section=\"summary\">x</section><section data-section=\"experience\">y</section>",
      jdText: jd,
      masterResumeHtml: "Audacy",
      writerJson: { letter: { hook: "word" }, resume: { roles: [] } },
    });
    assert.equal(out.issues.some((i) => i.code === "cover_letter_too_short"), true);
  });

  it("flags banned filler", async () => {
    const html = `<html><body><article class="page"><p>${"word ".repeat(360)} I am passionate about leverage.</p></article></body></html>`;
    const out = await critiqueMaterials({
      letterHtml: html,
      resumeHtml: "<section data-section=\"summary\">Audacy</section><section data-section=\"experience\">Audacy</section>",
      jdText: jd,
      masterResumeHtml: "Audacy",
      writerJson: { letter: { hook: "I am passionate about leverage." }, resume: { roles: [] } },
    });
    assert.equal(out.issues.some((i) => i.code === "banned_filler"), true);
  });

  it("fails HTML smuggled in a slot", async () => {
    const out = await critiqueMaterials({
      letterHtml: letterOf(360),
      resumeHtml: "<section data-section=\"summary\">Audacy</section><section data-section=\"experience\">Audacy</section>",
      jdText: jd,
      masterResumeHtml: "Audacy",
      writerJson: { letter: { hook: "<style>body{}</style>" }, resume: { roles: [] } },
    });
    assert.equal(out.issues.some((i) => i.code === "html_in_slot"), true);
    assert.equal(out.status, "fail");
  });
});
```

`auditCoverLetter` emits `cover_letter_too_short` when words < 325 (`COVER_MIN_WORDS`). Use that code. Severity is `review` in `materials-quality.mjs`; `critiqueMaterials` may keep it `review` unless other fail issues exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/materials-critic.test.mjs`

Expected: FAIL module not found.

- [ ] **Step 3: Implement `server/materials-critic.mjs`**

`statusFor`: any `fail` → `"fail"`; else any issue → `"review"`; else `"pass"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/materials-critic.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/materials-critic.mjs tests/materials-critic.test.mjs
git commit -m "feat: score drafted materials with measurable critic rules"
```

---

### Task 10: Writer and Editor LLM JSON

**Files:**
- Create: `server/materials-writer.mjs`
- Test: `tests/materials-writer.test.mjs`

**Interfaces:**
- Consumes: `resolveActivePin` result `{ provider, resolvedModel, apiKey, baseUrl }`; injected `fetchImpl`.
- Produces: `export async function callWriter(input: WriterInput): Promise<WriterJson>`; `export async function callEditor(input: WriterInput & { current: WriterJson, scorecard: object }): Promise<WriterJson>`; `export function parseWriterJson(text: string): WriterJson`.

`WriterInput = { pin, jdText, masterResumeHtml, voiceSamples, fetchImpl, timeoutMs? }`.

Gemini path: POST `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=` with `generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }`. Timeout via `AbortSignal.timeout(timeoutMs || 60000)`.

`parseWriterJson` extracts the first `{...}` block, `JSON.parse`, requires `letter` and `resume` objects. Throws `WriterJsonError` otherwise.

Invalid JSON: `callWriter` retries once, then throws.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callWriter, parseWriterJson } from "../server/materials-writer.mjs";

const valid = {
  letter: { hook: "Hello", whyThem: "Them", whyMe: "Me", whyNow: "Now", closing: "Bye", company: "EAB", role: "Dir" },
  resume: { summary: { opener: "Op", body: "Body" }, roles: [{ id: "audacy-dsm", bullets: ["Did X"] }] },
};

describe("parseWriterJson", () => {
  it("parses a fenced JSON payload", () => {
    const parsed = parseWriterJson("```json\n" + JSON.stringify(valid) + "\n```");
    assert.equal(parsed.letter.company, "EAB");
    assert.equal(parsed.resume.roles[0].id, "audacy-dsm");
  });

  it("throws on garbage", () => {
    assert.throws(() => parseWriterJson("not json"), /WriterJsonError|JSON/);
  });
});

describe("callWriter", () => {
  it("posts to the resolved Gemini model and returns JSON", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }],
        }),
      };
    };
    const out = await callWriter({
      pin: { provider: "gemini", resolvedModel: "gemini-3.7-flash", apiKey: "k", baseUrl: "" },
      jdText: "digital marketing strategy ".repeat(40),
      masterResumeHtml: "<p>Audacy</p>",
      voiceSamples: [],
      fetchImpl,
    });
    assert.equal(out.letter.company, "EAB");
    assert.match(calls[0].url, /gemini-3\.7-flash/);
    assert.doesNotMatch(JSON.stringify(calls[0].init), /"k"/); // key is query param; url may include it
  });

  it("retries once on invalid JSON then throws", async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "nope" }] } }] }) };
    };
    await assert.rejects(
      () =>
        callWriter({
          pin: { provider: "gemini", resolvedModel: "gemini-3.7-flash", apiKey: "k", baseUrl: "" },
          jdText: "x",
          masterResumeHtml: "y",
          voiceSamples: [],
          fetchImpl,
        }),
    );
    assert.equal(n, 2);
  });
});
```

The "key not in body" assertion is optional; do assert the URL contains the model id.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/materials-writer.test.mjs`

Expected: FAIL module not found.

- [ ] **Step 3: Implement**

System prompt must say: rewrite for this JD; freeze employers/titles/dates/metrics; JSON only matching the spec schema; no HTML/CSS.

`callEditor` is `callWriter` with extra user content: `JSON.stringify(scorecard)` + current JSON + "Rewrite to hit the scorecard. Same schema."

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/materials-writer.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/materials-writer.mjs tests/materials-writer.test.mjs
git commit -m "feat: writer and editor return tailored JSON from the setup pin"
```

---

### Task 11: Drafter FIFO + Editor loop + stop spawning Hermes

**Files:**
- Create: `server/materials-drafter.mjs`
- Modify: `server/materials-request.mjs` (enqueue instead of spawn)
- Modify: `server/index.mjs` (`POST /request` and `/repair` use enqueue; 409 when pin missing)
- Modify: `tests/materials-request-endpoint.test.mjs` (spawn stubs → enqueue stubs)
- Test: `tests/materials-drafter.test.mjs`

**Interfaces:**
- Consumes: `resolveJobDescription`, `composeCoverLetter`, `composeResume`, `critiqueMaterials`, `callWriter`, `callEditor`, `loadLlmConfig`, `resolveActivePin`, `getApplicationsRoot`, `writeJobDescription` (existing).
- Produces: `export function createMaterialsDrafter(deps)` → `{ enqueue(payload): Promise<{ ok: true, slug, pending_path, accepted: true }>, runNextForTests() }`.

Deps (all injectable): `{ applicationsRoot, loadPin, resolvePin, scrapeJob, readMasterResume, readMasterLetter, writer, editor, composer, critic, pdfRenderer, now }`.

Behavior:
1. `enqueue` writes `pending.json` (existing shape) and `job-description.md` if provided; returns immediately. If `loadPin()` is null, throw `Object.assign(new Error("No LLM pin configured."), { statusCode: 409, code: "llm_unconfigured" })` **before** writing pending.
2. FIFO: one `running` flag. Same slug while pending → return existing pending, do not start a second run.
3. Loop: JD gate → writer → composer (production templates: `integrations/hermes-job-hunt/resume-template/resume.html` and `cover-letter-template/cover-letter.html`; tests inject fixtures) → critic. If not pass and editor loops `< 2`, editor then composer again. Then `pdfRenderer` (default `{ skipped: true }`). Write `resume.html`, `cover-letter.html`, optional PDFs, `qa-report.md`.

Pending protocol (match `server/application-materials.mjs` + `role-materials.js`):
- On enqueue: write `pending.json` with `progress.phase = "queued"`, then flip to `"drafting"` when the FIFO starts the slug.
- On success (READY or REVIEW with files on disk): **delete** `pending.json`. `buildManifest` treats missing pending + present HTML as complete. Do not leave `phase: "complete"` behind.
- On hard failure (no pin already 409; scrape/writer crash): set `progress.phase = "failed"` and keep `pending.json` so the dossier FAILED card works. `dismissPending` already archives that file.

Read `role-materials.js` pending states (`queued` / `running` / `failed`) and `buildManifest` in `application-materials.mjs` before choosing how to clear pending. Match the poller, do not invent a third protocol.

4. `spawnMaterialsRequest` becomes a wrapper: `return drafter.enqueue(payload)`. Delete the `spawn` of `materials-request.sh`. Keep `normalizeRequestBody` as-is.

- [ ] **Step 1: Write the failing drafter test**

```js
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMaterialsDrafter } from "../server/materials-drafter.mjs";

const letterTpl = `<html><head><style>.x{}</style></head><body><p data-slot="hook">old</p><p data-slot="why-them"></p><p data-slot="why-me"></p><p data-slot="why-now"></p><p data-slot="closing"></p></body></html>`;
const resumeTpl = `<html><head><style>.x{}</style></head><body><section data-section="summary">s</section><article data-role="audacy-dsm"><ul><li>b</li></ul></article><section data-section="experience">e</section></body></html>`;

const goodJson = {
  letter: {
    hook: "I ship paid spend toward marginal ROAS for advancement teams.",
    whyThem: "EAB already owns the university relationships I have spent a decade earning.",
    whyMe: "At Audacy I ran a 10M digital P and L and took Denver to a top-3 national rank.",
    whyNow: "I want to point that operator-builder mix at alumni growth.",
    closing: "Happy to walk through the forecast stack.",
    company: "EAB",
    role: "Senior Director",
  },
  resume: {
    summary: { opener: "Operator.", body: "Paid media plus AI systems." },
    roles: [{ id: "audacy-dsm", bullets: ["Grew Denver to top-3 nationally on a 10M book."] }],
  },
};

describe("createMaterialsDrafter", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "jb-draft-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("409s without a pin and does not write pending", async () => {
    const drafter = createMaterialsDrafter({
      applicationsRoot: dir,
      loadPin: () => null,
    });
    await assert.rejects(
      () =>
        drafter.enqueue({
          slug: "eab-role",
          company: "EAB",
          title: "Director",
          feature: "both",
          jobUrl: "https://example.com/job",
          notes: "",
        }),
      (err) => err.statusCode === 409 && err.code === "llm_unconfigured",
    );
    await assert.rejects(readFile(join(dir, "eab-role", "pending.json")));
  });

  it("writes REVIEW with jd_unusable when scrape fails on a blurb", async () => {
    const drafter = createMaterialsDrafter({
      applicationsRoot: dir,
      loadPin: () => ({ provider: "gemini", model: "gemini-flash", apiKey: "k", baseUrl: "" }),
      resolvePin: async (pin) => ({ ...pin, resolvedModel: "gemini-3.7-flash" }),
      scrapeJob: async () => {
        throw new Error("nope");
      },
      readMasterLetter: async () => letterTpl,
      readMasterResume: async () => resumeTpl,
    });
    await mkdir(join(dir, "eab-role"), { recursive: true });
    await writeFile(join(dir, "eab-role", "job-description.md"), "Low fit — 4.7/10");
    await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.runUntilIdle();
    const report = await readFile(join(dir, "eab-role", "qa-report.md"), "utf8");
    assert.match(report, /jd_unusable/);
  });

  it("loops the editor once then READY when the second critic passes", async () => {
    let writerCalls = 0;
    let editorCalls = 0;
    let criticCalls = 0;
    const drafter = createMaterialsDrafter({
      applicationsRoot: dir,
      loadPin: () => ({ provider: "gemini", model: "gemini-3.7-flash", apiKey: "k", baseUrl: "" }),
      resolvePin: async (pin) => ({ ...pin, resolvedModel: "gemini-3.7-flash" }),
      scrapeJob: async () => ({ description: "digital marketing strategy advancement ".repeat(40) }),
      readMasterLetter: async () => letterTpl,
      readMasterResume: async () => resumeTpl,
      writer: async () => {
        writerCalls += 1;
        return goodJson;
      },
      editor: async () => {
        editorCalls += 1;
        return goodJson;
      },
      critic: async () => {
        criticCalls += 1;
        if (criticCalls === 1) {
          return { status: "review", issues: [{ code: "keyword_coverage_low", message: "thin", severity: "review" }] };
        }
        return { status: "pass", issues: [] };
      },
      pdfRenderer: async () => ({ skipped: true }),
    });
    await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.runUntilIdle();
    assert.equal(writerCalls, 1);
    assert.equal(editorCalls, 1);
    const html = await readFile(join(dir, "eab-role", "cover-letter.html"), "utf8");
    assert.match(html, /EAB|hook|marginal ROAS|advancement/i);
  });

  it("stops after two editor loops at REVIEW, never READY", async () => {
    let editorCalls = 0;
    const drafter = createMaterialsDrafter({
      applicationsRoot: dir,
      loadPin: () => ({ provider: "gemini", model: "gemini-3.7-flash", apiKey: "k", baseUrl: "" }),
      resolvePin: async (pin) => ({ ...pin, resolvedModel: "gemini-3.7-flash" }),
      scrapeJob: async () => ({ description: "digital marketing strategy advancement ".repeat(40) }),
      readMasterLetter: async () => letterTpl,
      readMasterResume: async () => resumeTpl,
      writer: async () => goodJson,
      editor: async () => {
        editorCalls += 1;
        return goodJson;
      },
      critic: async () => ({ status: "fail", issues: [{ code: "banned_filler", message: "x", severity: "fail" }] }),
      pdfRenderer: async () => ({ skipped: true }),
    });
    await drafter.enqueue({
      slug: "eab-role",
      company: "EAB",
      title: "Director",
      feature: "both",
      jobUrl: "https://example.com/job",
      notes: "",
    });
    await drafter.runUntilIdle();
    assert.equal(editorCalls, 2);
    const report = await readFile(join(dir, "eab-role", "qa-report.md"), "utf8");
    assert.match(report, /banned_filler|REVIEW|review/i);
  });
});
```

Also add a test in `tests/materials-request-endpoint.test.mjs` (or a new `tests/materials-request-no-hermes.test.mjs`) that `readFileSync("server/materials-request.mjs","utf8")` does **not** contain `spawn(` and does **not** contain `materials-request.sh`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/materials-drafter.test.mjs tests/materials-request-no-hermes.test.mjs`

Expected: FAIL module not found / spawn still present.

- [ ] **Step 3: Implement drafter + rewire request**

Default `pdfRenderer`: `async () => ({ skipped: true, note: "pdf_skipped" })` in this task; Task 12 adds Playwright.

`runUntilIdle` for tests: drain the FIFO. Production: `enqueue` kicks `void tick()` without awaiting the full loop so HTTP stays fast. HTTP handler still returns 202-shaped JSON `{ ok: true, slug, pending_path, requested_at }` matching what `role-materials.js` already parses. Read `spawnMaterialsRequest` current return shape in `tests/materials-request-endpoint.test.mjs` and keep field names.

On 409, `server/index.mjs` must `sendAppError` with that status so the dashboard does not toast success. `role-materials.js` already treats non-OK fetch as `auto-request-failed`.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/materials-drafter.test.mjs tests/materials-request-endpoint.test.mjs tests/materials-request-no-hermes.test.mjs`

Expected: PASS. Rewrite spawn-based cases in `materials-request-endpoint.test.mjs` to stub `createMaterialsDrafter` via an exported `setMaterialsDrafterForTests` **or** by injecting `enqueue` through `spawnMaterialsRequest(payload, { enqueue })`. Prefer the options bag already on `spawnMaterialsRequest` (`options.enqueue`).

- [ ] **Step 5: Commit**

```bash
git add server/materials-drafter.mjs server/materials-request.mjs server/index.mjs tests/materials-drafter.test.mjs tests/materials-request-endpoint.test.mjs tests/materials-request-no-hermes.test.mjs
git commit -m "feat: draft materials in-process without Hermes"
```

---

### Task 12: Optional PDF + template wiring + docs defaults

**Files:**
- Modify: `server/materials-drafter.mjs` (default `pdfRenderer`)
- Create: `server/materials-pdf.mjs`
- Test: `tests/materials-pdf.test.mjs`
- Modify: `QUICKSTART.md` / `SETUP.md` only if they still say Hermes writes drafts or OpenRouter free is the default writer. One paragraph each, no extra docs.

**Interfaces:**
- Consumes: dynamic `import("playwright")` inside try/catch.
- Produces: `export async function renderPdfIfPossible(html, outPath): Promise<{ skipped: boolean, path?: string, note?: string }>`. Missing playwright → `{ skipped: true, note: "pdf_skipped" }`. Never throw.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPdfIfPossible } from "../server/materials-pdf.mjs";

describe("renderPdfIfPossible", () => {
  it("returns pdf_skipped when playwright is unavailable or injected skip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-pdf-"));
    const result = await renderPdfIfPossible("<html><body>Hi</body></html>", join(dir, "out.pdf"), {
      playwrightImport: async () => {
        throw new Error("not installed");
      },
    });
    assert.equal(result.skipped, true);
    assert.equal(result.note, "pdf_skipped");
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/materials-pdf.test.mjs`

Expected: FAIL module not found.

- [ ] **Step 3: Implement**

```js
export async function renderPdfIfPossible(html, outPath, options = {}) {
  const load = options.playwrightImport || (() => import("playwright"));
  try {
    const { chromium } = await load();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.pdf({ path: outPath, format: "Letter", printBackground: true });
    } finally {
      await browser.close();
    }
    return { skipped: false, path: outPath };
  } catch {
    return { skipped: true, note: "pdf_skipped" };
  }
}
```

Wire as default `pdfRenderer` in `createMaterialsDrafter`. Append `pdf_skipped` to `qa-report.md` when skipped. READY is still allowed.

Update `config.example.js` comment block to say Gemini Flash is the recommended pin (if not done in Task 3). Grep `SETUP.md` and `QUICKSTART.md` for `Hermes` materials / `gpt-oss-120b` as the default writer; replace with "local scraper server + the model you picked at setup".

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/materials-pdf.test.mjs tests/materials-drafter.test.mjs tests/model-family.test.mjs tests/llm-config.test.mjs tests/materials-jd-gate.test.mjs tests/materials-composer.test.mjs tests/materials-writer.test.mjs tests/materials-critic.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/materials-pdf.mjs server/materials-drafter.mjs tests/materials-pdf.test.mjs SETUP.md QUICKSTART.md
git commit -m "feat: skip PDF cleanly when Playwright is missing"
```

---

## Self-review (spec coverage)

| Spec requirement | Task |
|---|---|
| One pin in `llm.json`, Settings/first-run write it | 2, 3 |
| Family alias `gemini-flash` → newest stable Flash, fallback 3.7 | 1, 2 |
| No cron | (none; live catalog already exists) |
| Weak `:free` warning exact copy | 3 |
| ATS / profile / rescore / dashboard use the pin | 4 |
| Discovery Gemini + matcher use the pin; non-Gemini skips Google tools | 5 |
| Browser Use Cloud not our pin | 5 (untouched) |
| `~/.jobbored/applications` + Hermes copy | 6 |
| JD gate, EAB blurb | 7 |
| Writer JSON, Composer Cheerio, no CSS | 8, 10 |
| Critic budgets + extras | 9 |
| Editor max 2, then REVIEW | 11 |
| No Hermes spawn, POST still accepted, 409 if no pin | 11 |
| PDF optional | 12 |
| Toast not a lie (409 before pending) | 11 |

No TBD remaining. Types `LlmConfig`, `WriterJson`, `createMaterialsDrafter` are named in the task that produces them and reused later.
