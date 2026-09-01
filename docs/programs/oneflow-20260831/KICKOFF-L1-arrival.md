# Lane L1 — arrival (Beats 1–3: Google · AI · Resume)

Read GROUND-RULES.md, SUBSTRATE.md, spec §5 B1–B3 (copy is normative). L0's substrate is merged into your branch: fill `oneflow-beat-google.js`, `oneflow-beat-ai.js`, `oneflow-beat-resume.js`; CSS goes only inside `/* ONEFLOW:L1 */` in css/oneflow.css.

**Mission:** Implement the arrival half of the flow — sign-in with automatic sheet creation, the required live-verified AI provider beat, and the resume beat whose dual-write + unrestricted drafting closes the keystone bug.

## Beat google (B1)
- Render per spec: headline/sub verbatim; `Continue with Google` drives the existing auth path (reuse `auth-session.js` sign-in entry — call, don't edit) then auto-creates the starter sheet by calling the existing creator in `sheet-access-setup.js` (:665-762 — if not exported, add a single named export there; that one line is granted inside your fence); stage list via `ctx.setBusy` (`Signed in as {email} ✓ → Creating your Pipeline sheet… → Sheet ready ✓`); auto-advance via `ctx.completeBeat({createdSheet})`.
- `Connect an existing sheet instead` → inline URL field, existing validation reused.
- First-timer `details` block with the normative copy: consent screen included, **no Drive API step**, honest "~10 minutes", **no gcloud button**.

## Beat ai (B2) — required, live-verified
- Provider cards: OpenRouter (pre-selected) · Gemini · OpenAI · Anthropic · Local. CORS note on OpenAI/Anthropic ("runs through the local server — keep npm start running"). Webhook option: absent.
- `Check & continue`: persist provider config via the existing override store (same write path first-run uses — reuse its helpers from `config-overrides.js`/`resume-generate.js`, calling not editing except `resume-generate.js` where you may add ONE exported `verifyResumeProviderLive()` that performs a real minimal completion round-trip). Beat completes ONLY on a passed check. Local passes only when the Ollama base URL actually answers. Failures → `ctx.setMessage(providerError, "error")` + `Having trouble?` details naming wrong-key / rate-limit / CORS fixes.
- Gemini chosen → also POST the key to `/__proxy/discovery-env-key` (`BROWSER_USE_DISCOVERY_GEMINI_API_KEY`) and say so with the normative line. Emit `key_check {beat:"ai", provider, ok, ms}` via STEPS.

## Beat resume (B3)
- Dropzone (drag/paste/browse). On receipt: `UC.setPrimaryResume(...)` AND send the extracted text server-side — extend `server/profile-from-resume.mjs` to accept `resumeText` in the request body, persist it to `~/.jobbored/resume.txt`, and prefer body text over disk lookups. Delete the `wants: leave []` / `avoids: leave []` prompt instructions (:373-374) so all six sections come back drafted.
- Stages via setBusy (4 normative lines); store the draft profile object in flow state for B4; `I'd rather start from a template` → embed the four starter templates' data in your module (copy the data, never import from fit-profile-wizard.js) → completeBeat({source:"template"}).
- Honest failure split kept: 404-style missing vs provider error, both through setMessage with retry + template paths.

## Tests — tests/oneflow-l1-*.test.mjs
Beat google: sheet-created completion path, existing-sheet path, no Drive/gcloud strings render. Beat ai: cannot complete without passed check; Local gated on live answer; Gemini write-through fires; error renders via message slot. Beat resume: dual-write ordering; server accepts body resumeText and writes the file (server-side test); prompt no longer contains "leave []"; template path completes. Update any existing server tests pinned to the old prompt.

## DoD
Full floor green (pasted). Legacy first-run/onboarding wizards untouched and still green. Report complete; committed locally, never pushed.
