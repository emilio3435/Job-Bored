# JHOS Approval Guard — Specification

> **Purpose:** Block any application submission until Emilio has explicitly approved it through two non-negotiable gates. This is the hard wall before any browser automation touches a submit button.

**Status:** `computer_use` is enabled for controlled browser assistance, but any submit action remains **blocked** until this guard is implemented and verified.

---

## Approved Implementation Decisions — 2026-05-26

- **Approval marker:** add an extension column named `Approval Status` after the existing JobBored worker/dashboard extension columns. Do not overload Column M `Status`, and do not use Column J `Tags`.
- **Final confirmation route:** use a dedicated submit-approval Telegram/Winky thread. Thread target: `telegram:-1003800236296:48` (derived from https://t.me/c/3800236296/48/50). Gate 2 is no longer blocked on target discovery.
- **Discovery expansion:** enable SerpApi / Google Jobs discovery once `SERPAPI_API_KEY` is stored securely; never write the key into tracked files.
- **Phase sequencing:** do not begin Phase 3 resume/cover-letter automation until discovery/writeback is verified end-to-end.

---

## Two-Gate Model

```
Gate 1: Pipeline Sheet             Gate 2: Chat Confirmation
────────────────────────           ─────────────────────────
Pipeline approval marker      →    Telegram/Chat final confirmation
        ↓                               ↓
   Agent may proceed               Agent may execute submit
   to prepare materials              + capture evidence
```

**Both gates are required.** Either gate failing blocks submission.

---

## Gate 1 — Interest Signal (Telegram reply OR Pipeline status ≥ Researching)

Gate 1 is a lightweight "yes, I'm interested" signal — not a full submission approval. It controls whether the system may draft materials and prepare an application. It is deliberately low-friction.

### Two equivalent ways to pass Gate 1

| Method | How it works |
|---|---|
| **Telegram reply** | When a job is discovered, the system sends a summary to the job-hunt Telegram thread. Emilio replies with `YES <company>`, `APPROVE <company>`, `👍`, or taps an inline button. The system marks the Pipeline row as `Researching` automatically. |
| **Pipeline status** | Emilio manually sets the row's Status (Column M) to `Researching` or any later lifecycle stage (`Applied`, `Phone Screen`, `Interviewing`, `Offer`). Any status beyond `New` signals interest. |

### Gate 1 passes when

```
Pipeline Status (Column M) is NOT in {"New", "", "Rejected", "Passed"}
```

That's it. If the status is `Researching`, `Applied`, `Phone Screen`, `Interviewing`, or `Offer`, Gate 1 is satisfied.

### Column X (Approval Status) — deprecated for Gate 1

Column X (`Approval Status`) was added in Phase 2 but added unnecessary friction. Gate 1 now reads Column M (`Status`) instead. Column X remains in the schema but is no longer required for the submit pipeline. It can be repurposed for tracking (e.g., "Materials Ready", "Submitted via Hermes") or removed in a future cleanup.

### Who sets it

- **Emilio** — either by replying in Telegram or changing the Pipeline status directly.
- **The system** — may set Status to `Researching` after receiving a Telegram approval reply, but may NOT advance past `Researching` without Gate 2.

### Discovery → Telegram notification flow

```
Discovery finds job → writes Pipeline row (Status = "New")
                    → sends Telegram summary to job-hunt thread
                    → Emilio replies YES / 👍 / taps button
                    → system sets Status = "Researching"
                    → Gate 1 satisfied → draft materials
```

---

## Gate 2 — Chat Confirmation (Telegram)

| Element | Requirement |
|---|---|
| Channel | Telegram (Winky bot) |
| Message type | Inline keyboard button — **irreversible by design** |
| Button label | `✅ Submit` if inline callbacks are available; otherwise an explicit final chat confirmation phrase such as `YES SUBMIT <company>` |
| Confirmation text | Job title, company, platform, and a one-line fit summary |
| Response window | 10 minutes; if no `✅ Submit` press, the pending submission is cancelled and the Kanban card is returned to `todo` |
| Cancellation | Any other message or timeout cancels the pending submission |

**Why prefer an inline button:** A button press is explicit, deliberate, and creates a Telegram message event with a callback query ID — making it auditable and non-repudiable. If the current delivery channel cannot support inline callbacks, use a strict final confirmation phrase and log the message ID.

---

## Submit Lock — Idempotency by Normalized Job URL

### Lock acquisition

Before any submission action, the agent must attempt to acquire a submit lock scoped to the **normalized job URL** (Column E).

```
lock_key = normalize(Column_E_url)
lock_ttl  = 15 minutes
lock_owner = HERMES_KANBAN_TASK_id
```

**Normalized URL rules:**
1. Strip `utm_*`, `ref=*`, `source=*`, `cid=*` query parameters
2. Lower-case the host and path
3. Remove trailing slashes
4. Strip `/apply` or `/jobs/` suffix variations when they point to the same posting
5. The result is the idempotency key

### Lock behavior

| Scenario | Result |
|---|---|
| Lock acquired successfully | Proceed to submission |
| Lock held by another active task | Skip — do not submit; log and exit |
| Lock expired | Re-acquire and proceed |

### Why this matters

If the discovery agent re-runs or two tasks target the same posting simultaneously, the lock ensures only one submit fires. A duplicate submit is a reputational risk.

---

## Screenshot / Evidence Capture

Immediately after a successful submit, the agent **must** capture:

1. **Submission confirmation screenshot** — the "Thanks for applying" or equivalent page rendered in the browser. Full viewport.
2. **Timestamp** — Unix epoch + human-readable (e.g. `2026-05-27T08:43:12-05:00 CT`)
3. **Job reference** — normalized URL, company, title
4. **Agent run ID** — the Kanban task that performed the submit

**Storage:**
```
~/.hermes/job-hunt/evidence/
  └── {normalized_url_slug}/
      ├── submit-{timestamp}.png
      └── metadata.json   ← {job_url, company, title, submitted_at, kanban_task, agent_run}
```

Evidence is written to local disk first, then the Pipeline row is updated:
- Column N (`Applied Date`) = `{date}`
- Column O (`Notes`) = append `Submitted {date} via Hermes — see evidence/ folder`

Evidence is **never** auto-deleted and **never** written to shared cloud storage without Emilio's explicit direction.

---

## No Direct Workday Automation

| Source | Policy |
|---|---|
| Workday.com job postings discovered via Google Jobs / SerpApi | ✅ Allowed — link is a public redirect |
| Direct Workday.com URL typed or pasted | ❌ Blocked — must be confirmed as a SerpApi/google redirect |
| Workday apply portal navigated directly | ❌ Blocked without Gate 1 + Gate 2 both passing + lock acquired |
| Workday apply via an ATS that wraps Workday (e.g. some Greenhouse integrations) | ✅ Allowed if the final submit lands on Greenhouse/Lever, not Workday directly |

Detection: any URL containing `workday.com` in the hostname is flagged. The apply flow must stop and block if the final submit URL contains `workday.com`.

**Rationale:** Workday's anti-automation detection is aggressive. Direct automation risks Emilio's IP being flagged, his account being locked, or his application being auto-rejected — all of which damage the search.

---

## Safe Failure States

### Failure: Gate 1 fails (approval marker ≠ Approved)
```
Action:   Do nothing. Log: "Gate 1 not satisfied — approval marker is {value}, requires 'Approved'"
Kanban:   No state change; task remains in current status
Telegram: No notification unless task was in an active apply workflow
```

### Failure: Gate 2 fails (no chat confirmation within 10 min)
```
Action:   Cancel the pending submission; release the submit lock
Kanban:   Card returns to todo with note "Cancelled — no confirmation received"
Telegram: Notify Emilio: "⏰ Submission for {Title} @ {Company} expired — card returned to queue"
```

### Failure: Lock not acquired (another task holds it)
```
Action:   Skip submission entirely — do not retry
Kanban:   Card remains in current status; no auto-retry for 24h
Telegram: Notify Emilio: "⚠️ {Title} @ {Company} skipped — another task is already submitting"
```

### Failure: Browser crash / network error during submit
```
Action:
  1. Attempt one retry after 60 seconds
  2. If retry fails, release lock and screenshot whatever browser state exists
  3. Write partial evidence: screenshot + {error} in metadata.json
Kanban:   Card → todo with note "Submit failed — evidence captured, retry manually"
Telegram: Notify Emilio: "❌ Submit failed for {Title} @ {Company} — evidence captured, retry required"
```

### Failure: Screenshot capture fails
```
Action:   Proceed anyway — submit is still valid; log the screenshot failure as a warning
Kanban:   Normal update; Pipeline row transitions to Applied after evidence is written
Telegram: Notify Emilio with the Pipeline row link: "✅ Applied to {Title} @ {Company} — screenshot evidence unavailable, verify in Pipeline"
```

---

## Implementation Checklist

- [ ] Gate 1 check function: reads the chosen Pipeline approval marker, returns bool
- [ ] Gate 2 Telegram inline button flow with 10-min timeout
- [ ] Submit lock: acquire / check / release primitives
- [ ] URL normalizer: strip tracking params, lowercase, trailing-slash
- [ ] Screenshot + metadata writer after every successful submit
- [ ] Workday hostname blocker in the URL validation layer
- [ ] All 5 failure states wired to Kanban + Telegram
- [ ] `skills/job-approval.md` created and tested against a real (non-Workday) apply flow

---

## Key Design Decisions

**Why not auto-approve after a delay?**
The point of Gate 2 is Emilio's deliberate consent. Auto-approval after timeout defeats the purpose.

**Why the 10-minute window?**
Long enough to read the Telegram on a phone; short enough that stale jobs don't pile up in pending state.

**Why write evidence to disk instead of Pipeline directly?**
Evidence files are timestamped, immutable, and survive Pipeline edits. Pipeline row updates are append-only notes. Both are kept.

**Why normalize the URL?**
`https://greenhouse.io/boards/1234/jobs/5678?utm_source=linkedin` and `https://boards.greenhouse.io/company/jobs/5678` are the same job. Idempotency must treat them as one.

---

## File Locations

| Artifact | Path |
|---|---|
| This spec | `~/.hermes/job-hunt/approval-guard-spec.md` |
| Skill | `~/.hermes/skills/job-approval.md` |
| Evidence root | `~/.hermes/job-hunt/evidence/` |
| Pipeline | Google Sheet `Pipeline` tab — Columns A–Q contract, R–T optional |