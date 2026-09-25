# JHOS Approval Guard — Specification

> **Purpose:** Block any application submission until the user has explicitly approved it through two non-negotiable gates. This is the hard wall before any browser automation touches a submit button.

**Machine contract:** [`approval-contract.v1.json`](./approval-contract.v1.json) is the single versioned source for Gate 1 / send / poll. Docs, `gate2_telegram.py`, `jhos_submit.py`, and `gate2-status-watcher.py` must read that file through `scripts/approval_contract.py`. Do not hardcode a competing Telegram thread.

**Per-user routing is local:** the tracked contract carries no chat, thread or user IDs. Each user copies [`approval-contract.local.example.json`](./approval-contract.local.example.json) to `approval-contract.local.json` (gitignored) and sets `gate2.chatId`, `gate2.threadId`, `gate2.approverUserIds`, `interest.chatId` and `interest.threadId`. Missing values fail closed: Gate 2 refuses to send or confirm, and the interest watcher refuses to post.

**Assisted apply is shelved (BEAUDIT §0.6).** `greenhouse_filler.py` is deleted, and the `universal_filler.py` CLI is dry-run only; the only live path is `apply-orchestrator.py`.

**Status:** `computer_use` is enabled for controlled browser assistance, but any submit action remains **blocked** until this guard is implemented and verified.

---

## Approved Implementation Decisions — 2026-05-26

- **Approval marker:** add an extension column named `Approval Status` after the existing JobBored worker/dashboard extension columns. Do not overload Column M `Status`, and do not use Column J `Tags`.
- **Final confirmation route:** use a dedicated submit-approval Telegram thread. Thread target: `telegram:<gate2.chatId>:<gate2.threadId>` from `approval-contract.local.json`. Gate 2 is no longer blocked on target discovery.
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

## Gate 1 — Pipeline Approval Status = `Approved`

Gate 1 is the submit-permission marker on the Pipeline row. It is **not** the interest/research signal (`Status = Researching` after `YES <company>`). Materials drafting may follow interest; submission may not.

### Gate 1 passes when

```
Pipeline Approval Status (Column X, field approvalStatus) == "Approved"
```

Fail closed on blank, any other value, or a missing column. Workers must not treat Column M `Status` as Gate 1.

### Who sets it

- **The user** — types `Approved` in the Pipeline `Approval Status` column when a row is allowed to submit.
- **The system** — may set Status to `Researching` after a Telegram interest reply, but may NOT set Approval Status and may NOT submit without Gate 1 + Gate 2.

### Discovery → interest vs submit

```
Discovery finds job → writes Pipeline row (Status = "New")
                    → sends Telegram summary to the interest (job-hunt) thread
                    → user replies YES <company>  → interest-approve.py
                    → system sets Status = "Researching"  (interest only; exact company match)
                    → user sets Approval Status = Approved  (Gate 1)
                    → Gate 2 YES SUBMIT <company> in telegram:<gate2.chatId>:<gate2.threadId>
                    → submit permitted
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
| Match rule | Exact, after normalizing case and whitespace: `YES SUBMIT <COMPANY>`. No substring or prefix matches |
| Reply target | The confirmation must be a Telegram reply to the request message (`reply_to_message.message_id` = request id) |
| Sender | `from.id` must be in `gate2.approverUserIds`; an empty list fails closed |
| Other replies | Any other reply to the request, or any other message from an approver in the thread, cancels |
| Blank company | The request is never sent, and no confirmation can match |
| Poller conflict | A `getUpdates` 409 Conflict (another consumer, such as the Hermes gateway, polls the same bot) cancels at once with that reason. Set `JHOS_GATE2_BOT_TOKEN` to a bot the gateway does not poll. The poll never flushes with `offset=-1`. |

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

**Normalized URL rules** — identical to `normalizeLeadUrl` in `integrations/browser-use-discovery/src/normalize/lead-normalizer.ts`, which writes the Pipeline Link cells. `tests/fixtures/url-normalize-parity.json` pins both implementations.
1. Strip only these exact query params: `utm_*`, `ref`, `source`, `src`, `gh_src`, `lever-source`, `fbclid`, `gclid`, `trk`
2. Lower-case the scheme and host; keep the path's case
3. Drop credentials, the fragment and default ports; remove trailing slashes
4. The result is the idempotency key

Gate 1 and the Applied write fail closed when more than one Pipeline row normalizes to the same key.

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

The orchestrator passes the filler's confirmation screenshot and its `universal-form-fill-results.json` path; `metadata.json` records `screenshot`, `screenshot_sha256`, `filler_results_path` and the `platform` derived from the job host.

A submit counts as verified only when the page navigated or the form disappeared **and** a success marker (for example "application submitted", "thanks for applying") appeared that was not on the page before the click. A bare "thank you" is not a marker.

**Storage:**
```
~/.hermes/job-hunt/evidence/
  └── {normalized_url_slug}/
      ├── submit-{timestamp}.png
      └── metadata.json   ← {job_url, company, title, submitted_at, kanban_task, agent_run}
```

Evidence is written to local disk first, then the Pipeline row is updated. The row is re-resolved by Link immediately before the write, the existing Notes come from that same read (a failed read aborts the write), and values are written RAW:
- Column N (`Applied Date`) = `{date}`
- Column O (`Notes`) = append `Submitted {date} via Hermes — see evidence/ folder`

Evidence is **never** auto-deleted and **never** written to shared cloud storage without the user's explicit direction.

---

## No Direct Workday Automation

| Source | Policy |
|---|---|
| Workday.com job postings discovered via Google Jobs / SerpApi | ✅ Allowed — link is a public redirect |
| Direct Workday.com URL typed or pasted | ❌ Blocked — must be confirmed as a SerpApi/google redirect |
| Workday apply portal navigated directly | ❌ Blocked without Gate 1 + Gate 2 both passing + lock acquired |
| Workday apply via an ATS that wraps Workday (e.g. some Greenhouse integrations) | ✅ Allowed if the final submit lands on Greenhouse/Lever, not Workday directly |

Detection: any URL containing `workday.com` in the hostname is flagged. The apply flow must stop and block if the final submit URL contains `workday.com`.

**Rationale:** Workday's anti-automation detection is aggressive. Direct automation risks the user's IP being flagged, their account being locked, or their application being auto-rejected — all of which damage the search.

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
Telegram: Notify the user: "⏰ Submission for {Title} @ {Company} expired — card returned to queue"
```

### Failure: Lock not acquired (another task holds it)
```
Action:   Skip submission entirely — do not retry
Kanban:   Card remains in current status; no auto-retry for 24h
Telegram: Notify the user: "⚠️ {Title} @ {Company} skipped — another task is already submitting"
```

### Failure: Submit attempted but not verified
```
Action:   Never retry automatically — a real submission may have happened
Kanban:   Comment "Submit attempted but not verified — check the employer portal before any retry"
Telegram: Notify the user: "⚠️ Manual verification required for {Title} @ {Company} … Do not retry automatically."
```

### Failure: Browser crash / network error before any submit click
```
Action:
  1. Attempt one retry after 60 seconds
  2. If retry fails, release lock and screenshot whatever browser state exists
  3. Write partial evidence: screenshot + {error} in metadata.json
Kanban:   Card → todo with note "Submit failed — evidence captured, retry manually"
Telegram: Notify the user: "❌ Submit failed for {Title} @ {Company} — evidence captured, retry required"
```

### Failure: Screenshot capture fails
```
Action:   Proceed anyway — submit is still valid; log the screenshot failure as a warning
Kanban:   Normal update; Pipeline row transitions to Applied after evidence is written
Telegram: Notify the user with the Pipeline row link: "✅ Applied to {Title} @ {Company} — screenshot evidence unavailable, verify in Pipeline"
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
The point of Gate 2 is the user's deliberate consent. Auto-approval after timeout defeats the purpose.

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