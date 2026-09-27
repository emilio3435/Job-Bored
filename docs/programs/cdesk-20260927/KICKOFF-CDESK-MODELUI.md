# Lane MODELUI: Settings shows the model the drafter really uses

Read `KICKOFF-CDESK-_SHARED.md` in this folder first; its rules bind you. Family: opus · medium, with `/frontend-design` loaded before you design anything. Worktree `~/Job-Bored.worktrees/cdesk-modelui`, branch `feat/cdesk-modelui`, base main `98903e29`.

**Why:** Settings keeps its own copy of the AI model in the browser (`resumeGeminiModel` and siblings, `settings-modal.js:251, 293, 601, 1138`). The resume/letter drafter uses the server pin in `~/.jobbored/llm.json` (`server/llm-config.mjs`, `GET/POST /api/llm-config` at `server/index.mjs:350-351`). On 2026-09-27 Settings showed `gemini-3.5-flash` while the server used `gemini-3.8-flash`. Emilio also cannot find the drafter's model log: it is only a console line (`server/materials-drafter.mjs:618-621`, `[materials] slug=… provider=… requested_model=… resolved_model=…`), which appears in a terminal he doesn't know to look at. Note: the drafter already writes `debug.llm {provider, requestedModel, resolvedModel}` into the job's pending record (`materials-drafter.mjs:623-630`); find where that surfaces (pending.json / manifest / run.json) before adding anything.

**Goal:** In Settings → AI provider, a person sees plainly which model drafts their materials and which model the last draft actually used, and is warned when the browser setting and the server disagree.

**Fence:** `settings-modal.js` (AI provider section only), its CSS block, a new small client module if cleaner (for example `llm-status.js`; request its `<script>` tag in report §5), tests under `tests/`. Server: only if the last-draft facts are not already readable, add the smallest additive read (prefer extending an existing GET response over a new route; if a new route is unavoidable, add it next to the existing llm-config routes in `server/index.mjs` and nowhere else). Do NOT edit `server/llm-config.mjs` beyond an additive field: another session is changing it (model fallback chain). Name any server edit in report §5.

**Success means:**
1. Settings → AI provider shows "Drafting with: <provider> · <model>" read from `GET /api/llm-config` when the local API answers.
2. When the browser's saved model differs from the server's, a warning names both and offers one button that makes them match (saving through the existing save path, which already POSTs `/api/llm-config`).
3. It shows "Last draft used <resolved model> for <role> · <relative time>" when that record exists. If the pin is a family alias (for example `gemini-flash` → `gemini-flash-latest`), say that the provider picks the version, in plain words, and suggest pinning an exact version if they want one.
4. When the API is unreachable (hosted page, server down), the section says so in one line and hides the comparison; no errors in the console.
5. Tests: happy path, mismatch warning plus fix button, alias wording, API-down state. At least one test for any server change (happy + error).
6. Full shared floor pasted; report first line `DONE`.

**Stop when:** committed on your branch, or blocked.
