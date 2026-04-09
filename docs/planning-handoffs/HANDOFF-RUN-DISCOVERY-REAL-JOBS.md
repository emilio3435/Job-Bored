# Handoff: “Make Run discovery add real jobs, not just hit the stub”

**Audience:** A planning or implementation model tasked with turning Job-Bored’s current discovery webhook wiring into a **real discovery path** that appends or updates **Pipeline** rows for a greenfield user.

**Goal:** Make **Run discovery** feel plug-and-play for a new user. After setup, clicking the button should either:

1. **actually** cause new prospective jobs to appear in the user’s **Pipeline** sheet, or
2. be **explicitly blocked / relabeled** until a real discovery engine is connected.

The product should no longer leave users in the ambiguous state of “webhook wiring succeeded, but nothing happens.”

---

## 1. Current reality

The repo now has a much better first-run setup and deploy story, but the core discovery engine is still missing.

### What already works

- The app can now:
  - save an OAuth client on first run,
  - create a **blank starter sheet** with the correct `Pipeline` headers,
  - gate the dashboard behind Google sign-in when the sheet is private,
  - deploy the **Apps Script webhook stub** from Settings,
  - verify public access before claiming Apps Script success,
  - steer the user to Cloudflare relay only after Apps Script is truly public,
  - persist the Worker URL correctly.

### What does **not** work yet

- The default Apps Script deployment is still just a **stub**:
  - `doPost` accepts the webhook payload,
  - optional `ENABLE_TEST_ROW=true` appends a `[CC test]` row,
  - otherwise it returns `ok: true` and does **not** discover jobs.

### Recent product fix

The app now tells the truth about this:

- Stub responses are surfaced as **stub-only** rather than “discovery started.”
- `Run discovery` now rejects JSON responses with `ok: false` even if the webhook returned HTTP 200.

That truthfulness is good, but it also exposes the real product gap: the endpoint is wired, but **no real jobs are being found**.

---

## 2. User pain to solve

The greenfield user expectation is straightforward:

- finish setup,
- click `Run discovery`,
- see real job leads show up.

Today they can instead end up here:

- sheet and auth setup work,
- Apps Script deploy works,
- relay works,
- webhook test works,
- but `Run discovery` does not append any real roles.

That is too much setup friction for a result that still feels “broken.”

---

## 3. Product standard going forward

The product should converge on one of these states:

### A. Real discovery is connected

- `Run discovery` is enabled.
- Clicking it causes **real Pipeline rows** to be created or updated.
- UI copy says jobs may appear after the downstream job finishes.

### B. Only stub wiring is connected

- `Run discovery` is **not** sold as a real discovery path.
- UI explicitly says:
  - “Webhook stub connected”
  - “No real discovery engine configured yet”
- The user is pointed to the next real step:
  - install an agent skill,
  - connect a scheduled job,
  - deploy a real discovery worker,
  - or replace the Apps Script stub with actual logic.

The product should not sit in between.

---

## 4. Constraints

These constraints matter:

- **No maintainer-hosted backend** is the current product principle.
- The dashboard is still a **static app**.
- Discovery remains **BYO** unless the repo ships a user-owned automation path.
- The dashboard writes and reads the user’s **own Google Sheet**.
- Browser `fetch` has real **CORS** constraints.
- Job scraping from random sites is brittle and may violate site rules; the next agent should pick a defensible data source or be explicit about that tradeoff.

The implementation should preserve the project’s current stance:

- user-owned credentials,
- user-owned automation,
- maintainers do not operate a central discovery service.

---

## 5. Recommended framing for the next agent

The next agent should not assume “make Apps Script smarter” is automatically the right answer.

The actual problem is:

> **What is the default real discovery engine for new users, and how does Job-Bored know whether it is connected?**

That breaks into two subproblems:

1. **Choose / implement a real discovery backend path**
2. **Make the UI distinguish stub wiring from real discovery readiness**

---

## 6. Candidate implementation paths

The next agent should explicitly evaluate these:

### Option A. Upgrade Apps Script from stub to real discovery

Pros:

- stays inside the current in-dashboard deploy story,
- Google-owned ecosystem,
- no extra provider account beyond Google.

Cons:

- Apps Script is not a search engine,
- external job-board scraping from Apps Script is brittle,
- quotas / request limits / anti-bot friction are likely,
- still may need additional API keys or a real source of jobs.

Use this only if the next agent can identify a viable, user-owned discovery source that Apps Script can call cleanly.

### Option B. Ship a real default discovery worker outside Apps Script

Examples:

- GitHub Actions workflow that runs discovery and writes rows,
- Cloudflare Worker or similar user-owned serverless job,
- local / scheduled Node script.

Pros:

- stronger runtime than Apps Script for discovery logic,
- easier to integrate with agent tooling,
- easier to call external APIs.

Cons:

- more moving parts than “Deploy Apps Script stub from dashboard,”
- may require additional user accounts or secrets,
- first-run UX must be clearer.

### Option C. Make `Run discovery` depend on agent-backed automation

Leverage the existing direction in:

- [integrations/openclaw-command-center/SKILL.md](../../integrations/openclaw-command-center/SKILL.md)
- [integrations/openclaw-command-center/README.md](../../integrations/openclaw-command-center/README.md)

Pros:

- aligns with repo philosophy,
- discovery can be much more flexible,
- can write directly to `Pipeline` with the existing contract.

Cons:

- not truly plug-and-play unless the agent install/run story is dramatically simplified,
- still needs a clear “connected vs not connected” state in the UI.

### Option D. Keep the stub, but demote it to verification-only

Pros:

- honest,
- easy to maintain.

Cons:

- does **not** solve the user’s actual “find jobs” expectation,
- only acceptable if paired with a real recommended default for discovery.

---

## 7. Strong recommendation

The next agent should likely treat this as **two deliverables**, not one:

### Deliverable 1. Product-state separation

Implement a first-class distinction between:

- **Webhook stub connected**
- **Real discovery connected**

This should drive:

- button enablement,
- labels / toasts,
- setup screens,
- docs.

### Deliverable 2. A real starter discovery path

Pick one default path that a greenfield user can actually complete.

If Apps Script cannot reasonably be that path, the product should say so and promote the real default instead.

---

## 8. Concrete requirements for the next implementation

### 8.1 Real discovery must write valid Pipeline rows

It must follow:

- [AGENT_CONTRACT.md](../../AGENT_CONTRACT.md)
- [schemas/pipeline-row.v1.json](../../schemas/pipeline-row.v1.json)

At minimum:

- write rows to the exact `Pipeline` tab,
- dedupe by **column E / Link**,
- populate columns A–Q in order,
- leave optional R–S alone if not supported.

### 8.2 The webhook / job must use `variationKey`

The repo contract already expects `variationKey` to bias runs and reduce duplicate leads.

### 8.3 The UX must be explicit

The next implementation should answer:

- Is the configured `discoveryWebhookUrl` a **stub** or a **real discovery endpoint**?
- If it is only a stub, why is `Run discovery` still visible?
- What exact next step makes it real?

### 8.4 The smoke-test path should remain

Keep `ENABLE_TEST_ROW=true` as a debugging path for webhook wiring.

It is still useful for:

- Apps Script deploy verification,
- relay verification,
- confirming sheet permissions.

But it should not be mistaken for job discovery.

---

## 9. Specific repo touchpoints

### Dashboard behavior

- [app.js](../../app.js)
  - `triggerDiscoveryRun`
  - `testDiscoveryWebhookFromSettings`
  - stub response detection / success copy
  - setup and sheet-access gating
  - Settings / discovery state UI

### Apps Script webhook

- [integrations/apps-script/Code.gs](../../integrations/apps-script/Code.gs)
  - currently a stub only
  - now returns explicit stub metadata:
    - `service`
    - `mode`
    - `appendedTestRow`
    - `realDiscoveryConfigured: false`

### Discovery contract and pipeline shape

- [AGENT_CONTRACT.md](../../AGENT_CONTRACT.md)
- [schemas/pipeline-row.v1.json](../../schemas/pipeline-row.v1.json)

### Existing agent-oriented discovery direction

- [integrations/openclaw-command-center/SKILL.md](../../integrations/openclaw-command-center/SKILL.md)
- [integrations/openclaw-command-center/README.md](../../integrations/openclaw-command-center/README.md)

### Setup docs that will need updates

- [README.md](../../README.md)
- [SETUP.md](../../SETUP.md)
- [docs/DISCOVERY-PATHS.md](../DISCOVERY-PATHS.md)
- [integrations/apps-script/README.md](../../integrations/apps-script/README.md)
- [integrations/apps-script/WALKTHROUGH.md](../../integrations/apps-script/WALKTHROUGH.md)

---

## 10. Specific questions the next agent should answer

1. **What is the default real discovery engine for a new user?**
2. **Can Apps Script realistically be that engine, or should it remain verification-only?**
3. **How does the dashboard know whether discovery is “real” vs “stub only”?**
4. **Should `Run discovery` be disabled until real discovery is connected?**
5. **What is the shortest greenfield path from blank setup to real rows appearing in `Pipeline`?**

---

## 11. Suggested phased plan

### Phase 1. State truthfulness

- Add a stored `discoveryEngineState` or equivalent:
  - `none`
  - `stub_only`
  - `real`
- Drive UI labels and button states from that state.
- Stop treating a plain stub deploy as “Run discovery ready.”

### Phase 2. Pick and implement one real discovery path

Examples:

- user-owned GitHub Action runner,
- user-owned worker,
- upgraded Apps Script implementation,
- agent-backed discovery path with a much simpler setup story.

### Phase 3. Greenfield UX

- Fold the chosen path into setup:
  - either as part of onboarding,
  - or as a clearly named “Connect real discovery” step after webhook wiring.

### Phase 4. Verification and docs

- Add an end-to-end QA checklist:
  - greenfield setup,
  - stub-only path,
  - real-discovery path,
  - failure messaging,
  - dedupe behavior.

---

## 12. Non-goals unless the product direction changes

- Building or hosting a central multi-tenant discovery backend for all users.
- Claiming Apps Script alone is a real discovery engine without solving the actual source-of-jobs problem.
- Reintroducing ambiguous success messaging that implies real jobs will appear when only the stub is configured.

---

## 13. One-line mission

**Make `Run discovery` either append real job rows for a new user, or make the product explicitly say that only webhook wiring is configured and guide the user to a real discovery engine.**
