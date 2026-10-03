# SCRP issue ledger: issue → fix → red-first test → candidate evidence → status

**Goal:** map every repair ID, capability and UX change to its files, commits, red-first test and candidate evidence.
**Success means:** every row names a commit and a test, and shows real evidence with its status.
**Stop when:** the final candidate is frozen and every row is filled. Rows marked ⏳ wait on FIX3.

| Short name | Meaning |
|---|---|
| *host floor* | Commands I ran myself on the integration branch, logged in `PROGRAM-LOG.md` |
| *QA-P2* | `reports/qa-phase2/QA-REPORT.md`, Astra browser acceptance on `a9ed80ce` |
| *R1/R2/R3* | The independent review verdicts in `reports/` |

All browser evidence uses fictional data and installed Chrome or Chromium with isolated storage.

## Repairs

| ID | Before (baseline 3641d33f) | Fix: files and commits | Red-first test | Candidate evidence | Status |
|---|---|---|---|---|---|
| **RISK-01** (R0) Stop vs measuring race | Controlled interleaving persisted `ready` after a winning Stop; `done` sent `[partial, ready]`; strict test 59/60 for Astra | `server/materials-versions.mjs`. `ea6eca25` synchronous terminal claim plus serialized queue. `00388821` reconnect replay behind persisted events. `7a8406af` and `a8d704f9` failed terminal write still delivers `done` to every subscriber. `13ccf37f` queue release | SCRP-B1/B2/B3 (`['partial','ready']` → `['partial']`), B17, B23, B30 | Host: E 20/20 strict-Stop runs in each of 7 host rounds (140/140), including the final frozen candidate. A green. QA-P2 Stop-during-checking PASS on both documents | ✅ Fixed. Exhaustive race freedom is not claimed |
| **ASTRA-01** Orphaned ready proposal after close, switch or resubmit | FAIL 6/6: generic 409, no controls, proposal stranded | Server: `53a92eba` GET `/edits/open` plus reprocess reset, `6daca654` shared eligibility. Client: `cdca3c8c`, `ad5b9752` recovery, guarded Send and awaited Discard. R1 #9/#14/#15/#18 and R2 #5/#6/#7 hardening | SCRP-B4–B7, F6–F11, F21 (browser, both documents), F23, F74–F76 | QA-P2: PASS 3/3 per document (recovered, draft kept, discard then retry 202). Host C green | ✅ Fixed |
| **ASTRA-02** Stop before the proposal ID arrives | FAIL 2/2: no stop sent, pending zero-op proposal, retry 409 | Client: `ad5b9752` request identity, stop intent, late-ID stop and generation guards. `978ed403` and `61a985c2` settle Stop from the server's terminal state | SCRP-F22 (deferred POST × Stop/close/switch/new editor, both documents), F77 | QA-P2: PASS. Null ID → late stop 200 → retry 202 | ✅ Fixed |
| **ASTRA-03** Saved text reported as "Not saved" when PDF fails | FAIL 2/2: UI said Not saved, duplicate Save got 409 | Server: `d70dd9ac` `retryable:false`, bring-back `n`/`versions`, sibling PDF kept. Client: `cdca3c8c` and `fc0fe18e` committed-503 handling. `336c35ff` no invented version number. Copy per D9 | SCRP-B8/B9/B10, B15/B16 (real PDF), B28 (production envelope), F3, F12, F24/F25 | QA-P2: PASS. Shows "Text saved as v1. PDF unavailable — it’s rebuilt on your next save."; no duplicate Save. Host F 4/4 | ✅ Fixed |
| **ASTRA-04** Stale-base retry kept the old header and redlines | FAIL 2/2 | Client: `fc0fe18e` exact-base install (C2 client contract) and iframe-load gate. `9f4e3978` load-token fence | SCRP-F14, F26 (real service), F20-race | QA-P2: PASS. Stale save refused, newer text kept, review uses the actual base | ✅ Fixed |
| **ASTRA-05** Safe server explanations replaced by "answered 409/503" | FAIL on both documents; provider and malformed replies both shown as template problems | Server: `d21a6710`, `f4aa53d2` writer classification with fixed safe messages; `e386d972` D20 mapping. Client: `e0c3d745`, `061bab37`, `a5cbbe97`, `15eeee34` mapped copy plus `nextStep` | SCRP-B11–B13, B18/B19, F13, F27/F28 (real service, 7 codes × both documents), F78 | QA-P2: PASS, cause-specific copy. Host C green | ✅ Fixed |

## Capabilities

| ID | Before | Fix | Red-first | Candidate evidence | Status |
|---|---|---|---|---|---|
| **GAP-02 / F1** Selection and focused-block scope | Selection existed, but requests always covered the whole document | `d30db904`, `d643fcbd` parent-installed listeners in a scriptless frame, server node IDs, scope pill, actions toolbar. R2 #11, R3 #3/#11 ⏳ | `tests/scribe-v2-selection.test.mjs` (0/20 pass on base together with the manual file), F43, F46, F47 (CSP) | QA-P2: PASS at 1440/375 on both documents (exact ID payload, stale refused, sibling op rejected). **Keyboard-only access FAILED (QA-KBD-01) → FIX3 D25** ⏳ | ⏳ |
| **GAP-01 / F2** Direct manual editing | No editor at all | `d30db904`, `d643fcbd` plain-text blocks, 2s debounce, one manual version. `2cddf8af` D21 batch confirm. `fe5b655a` D22 UTF-16 locks. `6a0bb42c` D23 role-close draft. `cf99e821` server gate. R3 #1/#2/#4–#7/#10/#12 ⏳ | `tests/scribe-v2-manual.test.mjs`, F44, F45, F71–F73, F79, B14 | QA-P2: PASS. One version, sibling unchanged, lock refused, plain paste, new-fact confirm, stale draft kept. R3-#2 edge insert next to a locked figure → FIX3 D24 ⏳ | ⏳ |

## UX and copy

See `UX-DELTA.md`: 10 before/after rows and 20 images, plus `COPY-BRIEF.md` for every string change.

| Change | Commit | Evidence | Status |
|---|---|---|---|
| Copy brief applied: no status codes, no "materials server", "suggested changes" vocabulary, one Discard label, D9 PDF copy | FE-1 `e0c3d745`…, FE-2 copy, R1 #12/#13/#23, R2 #9/#12 | `grep` finds no banned strings (R2/R3 reviewers). QA-P2 observed strings | ✅ |
| Recovery, status and scope/selection/manual/unsaved styling at 1440/375; 44px targets; no sideways scroll | `66c9d0bd`, `66efd440`, `4b36149b` | Visual 21/21 (SCRP-U1…U5). QA-P2 measured `scrollWidth` = viewport and controls ≥44px | ✅ |
| Score-modal Fix this / Apply / Repair → editor | none needed | QA-P1 and QA-P2: 24/24 on both documents at both widths | ✅ Verified, no defect |

## Proof lanes

| Lane | Result |
|---|---|
| Live provider (host-run, `a9ed80ce`) | Gemini `gemini-flash-latest`: 4/4 fictional requests (2 per document) → ready, accept 200, `edit` provenance, saved model and server preview contain the text, reopen persists, sibling byte-equal. Shown as server-rendered preview HTML, not a browser screenshot |
| Real installed-browser PDF | Host F 4/4. QA-P2 UI download, reopen and Poppler check on both documents: 1 page, fonts embedded, sibling PDF bytes equal |
| Full `npm test` (`b6a2f5fc`) | 7837 tests, 7826 pass, 4 fail, 0 skipped, 7 todo. The same failures (logo resolver with `RESOLVER=off`, submission-record ownership gate, E5 Docker boot) also fail on base 3641d33f: no regressions. Rerun on the final candidate ⏳ |
| WebKit / Safari | **Unavailable**: the WebKit 2359 download timed out twice. F1/F2 are proven in Chromium and Chrome only |
| Physical touch, iOS keyboard, screen-reader speech | Unverified. 375px coverage is desktop Chrome emulation |
