# SCRP round-1 review fixes (host rulings on reports/VERDICT-SCRP-R1.md)

**Goal:** Resolve every round-1 finding before the candidate freezes.
**Success means:** Each finding below has a red-first regression, or a stated reason why none is possible. A commit names the finding number. The owning lane's floor is green with `skipped 0`.
**Stop when:** Both lists are done and reported.

**Host rulings:**
- **D19.** Restore applies only to the desk's document. The client sends `{doc}`. The server restores only that document's model (`selectedDoc`), preserves the sibling, and answers with that document's `n` and `versions`. A missing `doc` keeps today's behavior. This resolves #2 and #3.
- **D20.** `http_401`, `http_403` and `http_404` from the writer map to `llm_unconfigured`. The COPY-BRIEF wins over SPEC §3A for these codes. The `llm_unconfigured` copy becomes: "The AI model isn’t set up correctly. Check it in **Settings**, then try again." `provider_failed` stays for network, timeout and 5xx only.

## BE-FIX lane (Sol): server only

Fence: `server/materials-versions.mjs`, `server/materials-regenerate.mjs`, `server/materials-edit.mjs`, `tests/integration/materials-edit-api.test.mjs`, `tests/materials-edit*.test.mjs`, a new or extended regenerate integration test, `docs/CONTRACT-CHANGELOG.md`.

| # | Fix |
|---|---|
| 1 [H] | `regeneratePackage` without `from` builds the model from each document's own current run, merges both, and commits `feature:"both"`. Test: a both-document package plus one resume save, then `regeneratePackage({template:"dossier"})`, leaves both HTML files and both `templateIds` on Dossier. |
| 2+3 | D19: restore takes `doc` from the body and restores only that document. Test the letter desk after a resume-only save: the letter gets the correct `n` and list, and the resume is unchanged. |
| 4 [M] | A failed terminal write never hangs or poisons the proposal. Use `await terminals.get(id)?.catch(()=>{})` in the `finally`. Replay starts from the `.catch`'d chain. Add a `.catch` on the `void processProposal(…)` chain that delivers `done` with the in-memory status and a fixed safe message. Test: a terminal write that fails once still delivers one `done`, replays on reconnect, and raises no unhandled rejection. |
| 5 [L] | One shared open-row predicate for the role gate and GET open. Test the malformed `ready` row with no `ops` array. |
| 6 [L] | D20 mapping, and update SCRP-B13. |
| 7 [L] | Prune `writes` and `terminals` on reject, on accepted, and on terminal states with no listeners. |
| 8 [L] | Blocked fallback IDs use `blocked-N`. |
| 25 [L] | One test sends a committed 503 through `withApiErrorEnvelope` (import it, or mount the real app error path) and checks that `retryable:false`, `run` and `versions` survive. If the function is not exported, export it minimally from `server/index.mjs`; this is the only allowed edit there. |
| — | CONTRACT-CHANGELOG entry for D19 and D20. |

## FE-2 lane (Sol): review fixes FIRST, one commit each, before continuing F1/F2

| # | Fix |
|---|---|
| 9 [H] | Discard during a running request aborts the stream and resets `busy`/stage. The banner hides Continue/Stop/Discard for the request that is already running. Unit test: Continue, then Discard, then Send posts. |
| 10 [H] | A `locked` blocked row always shows "Blocked: that would change a locked fact." Move the stub transcript (`scribe-v2-api.js` ~235) and the harness to the C4b blocked shape (`op:{opId}` plus fixed detail). Add a real-service locked case to SCRP-F27. |
| 11 [H] | Keep applying `op`/`proposal`/`done` frames until the stop reply arrives. On a stop rejection (especially `proposal_not_running`), call `readOpen` and hydrate the server's terminal state instead of showing an error. |
| 12 [M] | Client-made HTTP codes use their own prefix (`status_<n>`), and writer codes are mapped only from SSE or real bodies. A bodiless HTTP error shows "That didn’t work. Try again." |
| 13 [M] | For codes in the errorCopy table, show the mapped COPY-BRIEF copy and append `err.fix` (`nextStep`) when present. Server text is used only for unknown codes. Tests inject real server bodies (`server/route-limits.mjs:47-64`). |
| 14 [M] | Show no review controls on a recovered proposal until its status is `ready` or `partial`. |
| 15 [M] | The late-save branch rereads the open proposal (or clears `ctl.openProposal` when the ID matches). A stale "A save didn’t finish" never gates Send. |
| 16 [M] | Only a blocked row without `op` (a whole-request failure) sets the error status. Per-op blocks stay as log lines. |
| 17 [L] | Continue creates the proposal object when it is absent. Only a `ScribeApiError` message is ever shown; anything else gets fallback copy. |
| 18 [L] | No banner for the proposal already in `state.proposal` unless it is stale. Show the "choices weren’t kept" line only for a ready/partial proposal loaded from GET open. |
| 19 [L] | Clear/hide the status line in `send`, `loadDoc` and a successful `finishRun`. |
| 20 [L] | Bump and check `loadToken` in `installExactBase`. |
| 21 [L] | When `n` is missing, show "Text saved as a new version." |
| 22 [L] | The first F1/F2 commit adds `.scribe__selection-actions`, `.scribe__manual-state`, `[data-scribe-selected]`, `[data-scribe-editing]` and the `clear-scope` handler (it already lies in FE-2's scope). |
| 23 [L] | `scribe-v2-versions.js:504` uses "didn’t load" plus the #13 rule. |
| 24 [L] | Restore the strict assertion `/Stopped\. 2 changes ready to review\./` in `tests/scribe-v2-keyboard.test.mjs`. |
| 26 [L] | Covered by #10. |
| D19 client | `bringBack` sends `{doc}` (`api.restore(runId, {doc})`). The confirm copy needs no cross-document warning now. |
| D20 client | The `llm_unconfigured` copy per the D20 ruling. |

Finding 27 needs no change (recorded).
