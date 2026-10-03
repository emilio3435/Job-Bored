# SCRP round-2 review fixes (Astra verdict: reports/VERDICT-SCRP-R2.md — FAIL, 12 findings)

**Goal:** Resolve all 12 round-2 findings, each with a red-first regression.
**Success means:** One commit per finding, with the subject `fix(scribe): R2-#N …` and a red→green line in the report. The full lane floor is green with `skipped 0`.
**Stop when:** All 12 are done and the floor is pasted.

**Host rulings:**
- **D21 (#1).** "Save anyway" lists **every** unverified replacement in the batch: the quoted new text for each block. It confirms exactly the listed opIds, and the batch is frozen while the prompt is open. An edit after the prompt opens invalidates the prompt.
- **D22 (#2).** Each manual draft keeps its transformed UTF-16 locked spans. Rebasing spans by substring search is forbidden. Add a repeated-token regression.
- **D23 (#3).** When the role closes (hash navigation away) with an unsaved manual draft, the editor keeps the draft in the controller registry keyed by slug, doc and node. Reopening that role's editor restores the draft and shows "You have unsaved text. **Save** · **Discard**". D8 still holds: memory only, nothing that survives a page refresh. If a controller registry that survives a role close does not exist, add the smallest one.

| # | Fix |
|---|---|
| 1 | D21 |
| 2 | D22 |
| 3 | D23 |
| 4 (server) | The fallback terminal `done` goes to **every** remaining subscriber, once each. Test: two concurrent subscribers plus one failed terminal write → both end with exactly one `done`. |
| 5 | Hide the recovery controls only while a stream is actively running, or while equivalent usable review controls are on screen. An interrupted stream with a pending open proposal shows Continue/Stop/Discard. |
| 6 | The Discard 404 → GET-open-null path uses the same request-detachment and busy/stage cleanup as a successful DELETE. Recovery actions are disabled while the DELETE is pending. |
| 7 | Recovery reads carry a monotonically increasing sequence. Responses older than the latest save/discard completion are ignored. |
| 8 | Stop reconciliation keeps the already-received terminal proposal. If GET open fails, keep it rather than clearing it. |
| 9 | The compare-diff error, the Star announcement and the manual-save error all use the shared error formatter (mapped copy plus `nextStep`), and keep their own recovery action. |
| 10 | A zero-change blur clears the manual editing state. A document switch or navigation clears the document-specific manual status. |
| 11 | In a multi-block selection, Edit text is disabled with the explanation "Select one block to edit its text." (`aria-disabled` plus a title, or a visible hint). |
| 12 | The accessible doc label says "{N} suggested change(s)" and never says "proposal". |
