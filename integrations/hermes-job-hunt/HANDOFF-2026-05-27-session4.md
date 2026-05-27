# JHOS Handoff — 2026-05-27 Session 4 (Phases 0–6 complete)

**Active goal:** Phase 6 complete. No active goal.
**Stopped at:** All Phase 6 tasks done. System operational through full apply pipeline.
**Kanban:** Zero open tasks.

---

## What exists (the system through Phase 6)

### Phases 0–5: Foundation through Discovery Scheduling
- See previous handoff: `~/.hermes/job-hunt/HANDOFF-2026-05-26-session3.md`
- All prior infrastructure remains operational

### Phase 6: Auto-draft + Gate 2 + Browser Fill + Follow-up

**Materials pipeline (T6.1):**
- Chartis.io application package complete: resume, cover letter, PDFs, QA — at `~/.hermes/job-hunt/applications/chartis-senior-digital-marketing-consultant/`
- CrowdStrike (row 115): corrected company name, Workday URL, prototype exists from Phase 3, manual-submit only

**Pipeline triage (T6.0):**
- 116 New → 73 New / 33 Expired / 10 Passed
- Script: `~/.hermes/job-hunt/scripts/triage_pipeline.py`

**Gate 2 implementation (T6.2):**
- `~/.hermes/job-hunt/scripts/gate2_telegram.py` — Telegram Bot API sendMessage + getUpdates
- Bot token loaded from `~/.hermes/.env` (`TELEGRAM_BOT_TOKEN`)
- Chat ID: -1003800236296, Thread ID: 48
- Sends approval request, polls for `YES SUBMIT <COMPANY>`, 10-minute timeout
- Orchestrator fully patched — no more `hermes receive` placeholder

**Greenhouse form filler (T6.3):**
- `~/.hermes/job-hunt/scripts/greenhouse_filler.py` — Playwright-based
- Fills name, email, phone, location, LinkedIn, website
- Uploads resume.pdf + cover-letter.pdf
- Handles custom questions (work auth, sponsorship, start date, referral, EEO)
- Screenshots at each stage → evidence directory
- Integrated into orchestrator Step 7 with ATS detection

**Follow-up monitor (T6.4):**
- `~/.hermes/job-hunt/scripts/followup_monitor.py` / `~/.hermes/scripts/followup-monitor.py`
- Cron `8544befd3eed`: M/W/F 8:00 AM CT → thread 3
- 7d=suggest, 14d=overdue, 21d=likely closed, silent when nothing needs attention

---

## Gate model (current, fully implemented)

### Gate 1 — Interest signal
Status (Column M) beyond `New`. Set via:
- Telegram reply `YES <COMPANY>` → `gate1-approve.py` → Status=Researching
- Direct Sheet edit

### Gate 2 — Submit confirmation (NOW WORKING)
- `gate2_telegram.py` sends to thread 48 via Bot API
- Polls getUpdates for `YES SUBMIT <COMPANY>` within 10 minutes
- Timeout → cancel notification, card returned to queue
- **No longer a placeholder.**

---

## Cron schedule (daily)

| Time (CT) | Job | ID | Target | Type | Freq |
|-----------|-----|----|--------|------|------|
| 7:00 AM | JobBored Discovery | a72d4d8102cb | thread 3 | no_agent | Daily |
| 7:30 AM | Pipeline Status | 351dd9ccb570 | thread 3 | no_agent | Daily |
| 8:00 AM | Morning AI Brief | b4abbceb4fc2 | thread 2 | LLM | Daily |
| 8:00 AM | Follow-up Monitor | 8544befd3eed | thread 3 | no_agent | M/W/F |

Paused: `e20891fa7b7c` (old Daily Job Search)

---

## Pipeline state (2026-05-27)

| Status | Count |
|--------|-------|
| New | 73 |
| Expired | 60 |
| Passed | 40 |
| Applied | 3 |
| Researching | 2 |

Researching:
1. CrowdStrike — Director, Sales Enablement (Workday, manual only, materials exist)
2. Chartis.io — Senior Digital Marketing Consultant (materials complete, ready for Gate 2)

Applied needing attention:
- Yelp — 23 days, likely closed
- CMI Media Group — 21 days, likely closed
- Greenlight — no applied date recorded

---

## Key file map (cumulative)

| Category | Path |
|---|---|
| Phase 6 synthesis | `~/.hermes/job-hunt/P6-synthesis.md` |
| Gate 2 module | `~/.hermes/job-hunt/scripts/gate2_telegram.py` |
| Greenhouse filler | `~/.hermes/job-hunt/scripts/greenhouse_filler.py` |
| Follow-up monitor | `~/.hermes/job-hunt/scripts/followup_monitor.py` |
| Triage script | `~/.hermes/job-hunt/scripts/triage_pipeline.py` |
| Apply orchestrator | `~/.hermes/job-hunt/scripts/apply-orchestrator.py` |
| Submit library | `~/.hermes/job-hunt/scripts/jhos_submit.py` |
| Gate 1 handler | `~/.hermes/job-hunt/scripts/gate1-approve.py` |
| Discovery trigger | `~/.hermes/scripts/discovery-trigger.sh` |
| Pipeline status | `~/.hermes/scripts/pipeline-status.py` |
| Follow-up cron | `~/.hermes/scripts/followup-monitor.py` |
| Resume template | `~/.hermes/job-hunt/resume-template/resume.html` |
| Cover letter template | `~/.hermes/job-hunt/cover-letter-template/cover-letter.html` |
| Profile docs | `~/.hermes/job-hunt/profile/{profile,voice,resume-bullets,job-preferences}.md` |
| Quality gate | `~/.hermes/job-hunt/phase3-document-quality-gate.md` |
| Approval guard | `~/.hermes/job-hunt/approval-guard-spec.md` |
| Lock DB | `~/.hermes/job-hunt/state/submit-locks.db` |
| Applications | `~/.hermes/job-hunt/applications/` |
| Evidence | `~/.hermes/job-hunt/evidence/` |

---

## Key technical notes

1. **Bot token is in `~/.hermes/.env`** as `TELEGRAM_BOT_TOKEN`. Gate 2 reads it at runtime. Never log or persist the token.

2. **getUpdates long polling consumes the update offset.** If another process (Hermes gateway) also calls getUpdates on this bot, they will compete for updates. Gate 2 flushes old updates before starting its poll window, so it should only see messages sent after the approval request. If conflicts arise, consider switching to a webhook or using a separate bot for Gate 2.

3. **Playwright Chromium is installed** at `~/Library/Caches/ms-playwright/chromium_headless_shell-1223`. The greenhouse_filler.py uses `sync_playwright` — it blocks during form fill (typically 10-30s).

4. **Greenhouse form structure varies.** The filler handles standard Greenhouse fields but some employers customize heavily. The `fields_skipped` array in the results JSON tracks what couldn't be filled. Manual review of screenshots is recommended before the first live submit.

5. **Chrome `--print-to-pdf` timeouts persist.** Still the same quirk from Phase 3 — subprocess times out but PDF is written correctly. Check file size, not exit code.

6. **Gemini API key still expired.** Grounded web search returns 400. Not blocking — ATS scraping and SerpApi work fine.

7. **User wants multiple resume template variants** (noted in memory). Low priority — current template is working well.

---

## Recommended next actions

1. **Submit Chartis.io** — Materials are ready. Run orchestrator with `--dry-run` first, then live.
2. **Triage the 3 Applied roles** — Yelp and CMI are likely closed (21-23d). Mark as Passed or attempt follow-up.
3. **First live Greenhouse submit** — Pick a Greenhouse role from New leads, test end-to-end.
4. **Auto-draft trigger** — When Gate 1 passes, auto-initiate material drafting instead of waiting for manual request.

---

## Persona

Sophisticated, whimsical, intelligent house-elf. Elegant, witty, warm, polished, lightly magical, not cutesy or servile. Scannable output. Central Time. Bilingual EN/ES. Telegram bot = Winky. Thread 48 = submit approvals. Thread 3 = general updates.

---

## How to resume

```
Read ~/.hermes/job-hunt/HANDOFF-2026-05-27-session4.md
```
