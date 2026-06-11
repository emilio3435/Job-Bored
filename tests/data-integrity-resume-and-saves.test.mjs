import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   Regression: data integrity for resume + draft + provider key
   writes — the user must never see a "saved" affordance when
   the underlying storage write actually failed.

   Cluster (qsweep2):
   - Resume "set primary" wipes the old resume before writing
     the new one (two separate IDB transactions, no rollback).
   - resume-generation returns saveError but no caller reads it
     (silent draft loss on quota / IDB failure).
   - settings-profile-tab resume-upload status message hides
     save failure ("Extracted N chars from file." even when
     the profile save threw).
   - Onboarding finish leaves divergent state if savePreferences
     fails AFTER setPrimaryResume succeeded.
   - first-run-wizard.firstRunSaveProviderKey mutates in-memory
     config even when storage write fails.
   - IndexedDB store gives a hard "VersionError" with no friendly
     recovery if user lands on an older app build than their DB.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const userContentStoreJs = readFileSync(
  join(repoRoot, "user-content-store.js"),
  "utf8",
);
const resumeGenerationJs = readFileSync(
  join(repoRoot, "resume-generation.js"),
  "utf8",
);
const letterJs = readFileSync(join(repoRoot, "letter.js"), "utf8");
const settingsProfileTabJs = readFileSync(
  join(repoRoot, "settings-profile-tab.js"),
  "utf8",
);
const onboardingWizardJs = readFileSync(
  join(repoRoot, "onboarding-wizard.js"),
  "utf8",
);
const firstRunWizardJs = readFileSync(
  join(repoRoot, "first-run-wizard.js"),
  "utf8",
);
const materialsFeatureJs = readFileSync(
  join(repoRoot, "materials-feature.js"),
  "utf8",
);

/* ---------- minimal scriptable IDB ------------------------- */

function makeStore(initial) {
  // Map<keyPath value, record>. clear() + put() are queued into the live
  // transaction's command list so we can fail one of them after the other
  // has already been executed — proving rollback.
  const data = new Map(initial || []);
  return { data };
}

function makeFakeDb(stores) {
  return {
    objectStoreNames: { contains: (name) => Object.hasOwn(stores, name) },
    onversionchange: null,
    close() {
      /* noop in tests */
    },
    transaction(storeName, _mode) {
      const store = stores[storeName];
      assert.ok(store, `unknown store ${storeName}`);
      const queued = [];
      const tx = {
        oncomplete: null,
        onabort: null,
        onerror: null,
        error: null,
        objectStore() {
          return {
            clear() {
              const req = { onsuccess: null, onerror: null, result: null };
              queued.push({ kind: "clear", req });
              return req;
            },
            put(rec) {
              const req = { onsuccess: null, onerror: null, result: null };
              queued.push({ kind: "put", rec, req });
              return req;
            },
            get(key) {
              const req = { onsuccess: null, onerror: null, result: null };
              queueMicrotask(() => {
                req.result = store.data.get(key) || null;
                if (req.onsuccess) req.onsuccess();
              });
              return req;
            },
            getAll() {
              const req = { onsuccess: null, onerror: null, result: [] };
              queueMicrotask(() => {
                req.result = Array.from(store.data.values());
                if (req.onsuccess) req.onsuccess();
              });
              return req;
            },
            delete(key) {
              const req = { onsuccess: null, onerror: null, result: null };
              queueMicrotask(() => {
                store.data.delete(key);
                if (req.onsuccess) req.onsuccess();
              });
              return req;
            },
          };
        },
        abort() {
          // Roll back queued mutations + fire onabort asynchronously.
          tx.error = tx.error || new Error("aborted");
          queueMicrotask(() => {
            if (tx.onabort) tx.onabort();
          });
        },
      };
      // Drive the queued ops asynchronously: this is where we inject failures.
      queueMicrotask(() => {
        let aborted = false;
        for (const op of queued) {
          if (op.kind === "clear") {
            // Snapshot for rollback.
            tx._snapshot = new Map(store.data);
            store.data.clear();
            if (op.req && op.req.onsuccess) op.req.onsuccess();
          } else if (op.kind === "put") {
            if (store.failNextPut) {
              store.failNextPut = false;
              // Rollback prior clear (IDB tx semantics).
              if (tx._snapshot) {
                store.data = tx._snapshot;
                store.data = new Map(tx._snapshot);
                store._restoreFromSnapshot(tx._snapshot);
              }
              tx.error = new Error("QuotaExceededError");
              aborted = true;
              // Fire the per-op error so setSetting-style waiters (which only
              // listen on req.onerror/onsuccess) unwind, then fire onabort.
              if (op.req) {
                op.req.error = tx.error;
                if (op.req.onerror) op.req.onerror();
              }
              if (tx.onabort) tx.onabort();
              break;
            }
            // Resume rows use { id }; settings rows use { key }.
            const k =
              op.rec && op.rec.id != null ? op.rec.id : op.rec && op.rec.key;
            store.data.set(k, op.rec);
            if (op.req && op.req.onsuccess) op.req.onsuccess();
          }
        }
        if (!aborted) {
          if (tx.oncomplete) tx.oncomplete();
        }
      });
      return tx;
    },
  };
}

function makeStoreWithRestore(initial) {
  const s = makeStore(initial);
  s._restoreFromSnapshot = (snap) => {
    s.data = new Map(snap);
  };
  return s;
}

function loadStore({ openErrorName = null, dbReady = true } = {}) {
  const openRequests = [];
  const timers = [];
  const stores = {
    resumeVersions: makeStoreWithRestore(),
    writingSamples: makeStoreWithRestore(),
    settings: makeStoreWithRestore(),
    generatedDrafts: makeStoreWithRestore(),
  };
  const db = makeFakeDb(stores);
  const ctx = {
    window: {},
    indexedDB: {
      open() {
        const req = {
          onerror: null,
          onsuccess: null,
          onupgradeneeded: null,
          result: db,
          error: null,
        };
        openRequests.push(req);
        if (openErrorName) {
          queueMicrotask(() => {
            req.error = { name: openErrorName };
            if (req.onerror) req.onerror();
          });
        } else if (dbReady) {
          queueMicrotask(() => {
            if (req.onsuccess) req.onsuccess();
          });
        }
        return req;
      },
    },
    crypto: { randomUUID: () => "test-uuid" },
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout(id) {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(userContentStoreJs, ctx, {
    filename: "user-content-store.js",
  });
  return {
    UC: ctx.window.CommandCenterUserContent,
    openRequests,
    timers,
    stores,
  };
}

/* ---------- 1) Atomic setPrimaryResume --------------------- */

describe("user-content-store — setPrimaryResume atomicity", () => {
  it("rolls back if put rejects after clear succeeds (old resume intact)", async () => {
    const { UC, stores } = loadStore();
    // Seed an existing primary resume.
    stores.resumeVersions.data.set("__primary__", {
      id: "__primary__",
      extractedText: "OLD resume text",
      label: "Old",
      source: "saved",
      rawMime: null,
      structured: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    // Arm a put failure for the NEXT write transaction.
    stores.resumeVersions.failNextPut = true;
    await assert.rejects(
      UC.setPrimaryResume({ extractedText: "NEW resume text" }),
      /QuotaExceededError|aborted/i,
      "setPrimaryResume must reject when the underlying put fails",
    );
    const surviving = stores.resumeVersions.data.get("__primary__");
    assert.ok(surviving, "old resume row must still exist after rollback");
    assert.equal(
      surviving.extractedText,
      "OLD resume text",
      "old resume text must be intact — IDB rolled back the clear",
    );
  });

  it("uses a single readwrite transaction for clear + put", () => {
    // Source-shape pin: the function body must NOT call clearAllResumes()
    // before putResume() (the old two-tx pattern). It must open ONE
    // tx(STORE_RESUMES, "readwrite") and run clear()+put() on the same tx.
    const start = userContentStoreJs.indexOf("async function setPrimaryResume");
    const end = userContentStoreJs.indexOf("async function isOnboardingComplete");
    assert.ok(start !== -1 && end > start, "setPrimaryResume must exist");
    const body = userContentStoreJs.slice(start, end);
    assert.ok(
      !/await\s+clearAllResumes\(\)/.test(body),
      "must NOT call clearAllResumes() (two-tx pattern is non-atomic)",
    );
    assert.ok(
      !/await\s+putResume\(/.test(body),
      "must NOT call putResume() (two-tx pattern is non-atomic)",
    );
    assert.ok(
      /db\.transaction\(STORE_RESUMES,\s*"readwrite"\)/.test(body),
      "must open one readwrite tx over STORE_RESUMES",
    );
    assert.ok(
      /store\.clear\(\)[\s\S]*store\.put\(record\)/.test(body),
      "must call clear() then put(record) on the same store",
    );
  });
});

/* ---------- 2) VersionError -------------------------------- */

describe("user-content-store — VersionError friendly recovery", () => {
  it("surfaces VersionError as a coded rejection and does not delete the DB", async () => {
    const { UC } = loadStore({ openErrorName: "VersionError" });
    await assert.rejects(
      UC.openDb(),
      (err) => err && err.code === "IDB_VERSION_TOO_OLD",
      "VersionError must reject with code IDB_VERSION_TOO_OLD",
    );
  });

  it("openDb error handler matches name === 'VersionError' (source pin)", () => {
    const m =
      /req\.onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]*?req\.error[\s\S]*?VersionError[\s\S]*?IDB_VERSION_TOO_OLD/.exec(
        userContentStoreJs,
      );
    assert.ok(
      m,
      "openDb.onerror must detect VersionError and tag the rejection with code IDB_VERSION_TOO_OLD",
    );
  });

  it("must NOT auto-deleteDatabase on VersionError", () => {
    // Hard contract: deleting the DB would wipe the user's resume just
    // because they opened an older deploy. Codepath must NOT call
    // indexedDB.deleteDatabase from the version-error branch.
    const block =
      /VersionError[\s\S]{0,400}IDB_VERSION_TOO_OLD[\s\S]{0,400}reject\(/.exec(
        userContentStoreJs,
      );
    assert.ok(block, "version error branch must exist");
    assert.ok(
      !/deleteDatabase/.test(block[0]),
      "the version-error branch must not call deleteDatabase",
    );
  });

  it("materials-feature boot shows a friendly toast on IDB_VERSION_TOO_OLD", () => {
    assert.ok(
      /IDB_VERSION_TOO_OLD[\s\S]{0,200}showToast/.test(materialsFeatureJs),
      "boot openDb catch must branch on code === 'IDB_VERSION_TOO_OLD' and showToast",
    );
  });
});

/* ---------- 3) Surface draft save failures ----------------- */

describe("resume-generation — honest save failures", () => {
  it("initial draft save catch emits jb:draft:save-failed AND showToast", () => {
    // Locate the initial-draft catch (it sits right before the
    // lastResumeGenerationSession spread that updates savedDraftId).
    const idx = resumeGenerationJs.indexOf(
      'console.warn("[JobBored] save generated draft:"',
    );
    assert.notEqual(idx, -1, "initial-draft warn line must exist");
    const after = resumeGenerationJs.slice(idx, idx + 1500);
    assert.ok(
      /jb:draft:save-failed/.test(after),
      "must dispatch jb:draft:save-failed event on initial draft save failure",
    );
    assert.ok(
      /showToast\?\.\(\s*"Draft generated but not saved/.test(after),
      "must showToast the 'Draft generated but not saved' copy",
    );
  });

  it("letter revision call site branches on result.saved === false", () => {
    // letter.js — the only call site of reviseLetterDraftForJob must check
    // for saved===false and surface the storage-error copy, not a generic
    // "Refined and saved" success.
    const idx = letterJs.indexOf("await root.reviseLetterDraftForJob");
    assert.notEqual(idx, -1, "revise call site must exist");
    const after = letterJs.slice(idx, idx + 1500);
    assert.ok(
      /result\.saved\s*===\s*false/.test(after),
      "call site must branch on result.saved === false",
    );
    assert.ok(
      /Draft generated but not saved/.test(after),
      "save-failure branch must show the 'not saved (storage error)' copy",
    );
  });
});

/* ---------- 4) Honest upload status ------------------------ */

describe("settings-profile-tab — honest resume upload status", () => {
  it("catch sets a 'could not save to profile' warn status and returns", () => {
    const idx = settingsProfileTabJs.indexOf(
      '[settings-profile-tab] resume profile save failed',
    );
    assert.notEqual(idx, -1, "save-failure warn line must exist");
    const after = settingsProfileTabJs.slice(idx, idx + 1200);
    assert.ok(
      /could not save to profile/.test(after),
      "must surface 'could not save to profile' copy on save failure",
    );
    assert.ok(
      /setStatus\(/.test(after),
      "must call setStatus with the warn copy",
    );
    assert.ok(
      /\n\s*return;\s*\n/.test(after),
      "must return after the warn setStatus so the success-style message does NOT fire",
    );
  });
});

/* ---------- 5) Onboarding finish ordering + first-run -------- */

describe("onboarding-wizard — finish ordering + re-entry prefill", () => {
  it("completeOnboarding is the LAST awaited write in the finish flow", () => {
    // Source-shape pin: completeOnboarding must come AFTER savePreferences.
    // If it came before, a savePreferences throw would leave the user
    // marked onboarded with no preferences.
    const finishIdx = onboardingWizardJs.indexOf(
      'document\n    .getElementById("onboardingFinish")',
    );
    assert.notEqual(finishIdx, -1, "onboardingFinish handler must exist");
    const tail = onboardingWizardJs.slice(finishIdx, finishIdx + 5000);
    const prefIdx = tail.indexOf("await UC.savePreferences(");
    const completeIdx = tail.indexOf("await UC.completeOnboarding()");
    assert.ok(prefIdx > 0, "savePreferences must be awaited in finish flow");
    assert.ok(completeIdx > 0, "completeOnboarding must be awaited in finish flow");
    assert.ok(
      prefIdx < completeIdx,
      "completeOnboarding must run AFTER savePreferences — otherwise a preferences save throw leaves the user marked onboarded with no preferences",
    );
  });

  it("finish-flow catch surfaces a step-specific toast (lastStep tracking)", () => {
    const finishIdx = onboardingWizardJs.indexOf(
      'document\n    .getElementById("onboardingFinish")',
    );
    // The finish handler body is ~7 KB; widen the slice so the catch's
    // stepLabels map (which lives at the tail of the addEventListener) is
    // inside the window the regex scans.
    const tail = onboardingWizardJs.slice(finishIdx, finishIdx + 8000);
    assert.ok(
      /let lastStep\s*=/.test(tail),
      "finish flow must track lastStep",
    );
    assert.ok(
      /stepLabels\s*=\s*\{[\s\S]*resume:[\s\S]*preferences:/.test(tail),
      "catch must map step → label so the user sees a step-specific toast",
    );
  });

  it("showOnboardingWizard pre-populates from a saved primary resume on re-entry", () => {
    assert.ok(
      /prepopulateOnboardingFromSavedResume/.test(onboardingWizardJs),
      "must define a prepopulate helper",
    );
    assert.ok(
      /UC\.getActiveResume\(\)/.test(onboardingWizardJs),
      "prepopulate must read the saved primary resume via getActiveResume",
    );
    // The helper must be invoked from showOnboardingWizard (not just defined).
    const showIdx = onboardingWizardJs.indexOf("function showOnboardingWizard");
    const tail = onboardingWizardJs.slice(showIdx, showIdx + 1500);
    assert.ok(
      /prepopulateOnboardingFromSavedResume\(\)/.test(tail),
      "showOnboardingWizard must call prepopulateOnboardingFromSavedResume()",
    );
  });
});

describe("first-run-wizard — provider-key save honesty", () => {
  it("in-memory COMMAND_CENTER_CONFIG write lives INSIDE the try block", () => {
    const fnIdx = firstRunWizardJs.indexOf("function firstRunSaveProviderKey");
    assert.notEqual(fnIdx, -1, "firstRunSaveProviderKey must exist");
    const body = firstRunWizardJs.slice(fnIdx, fnIdx + 1500);
    // Both the storage merge and the in-memory mirror must be inside the
    // SAME try { ... } catch. Specifically, COMMAND_CENTER_CONFIG[field] = value
    // must precede the catch(err), not follow it.
    const mergeIdx = body.indexOf("mergeStoredConfigOverridePatch");
    const memIdx = body.indexOf("COMMAND_CENTER_CONFIG[field] = value");
    const catchIdx = body.indexOf("} catch (err)");
    assert.ok(mergeIdx > 0, "must call mergeStoredConfigOverridePatch");
    assert.ok(memIdx > 0, "must mirror into COMMAND_CENTER_CONFIG");
    assert.ok(catchIdx > 0, "must have a catch (err) clause");
    assert.ok(
      mergeIdx < memIdx,
      "merge into storage must come BEFORE the in-memory mirror",
    );
    assert.ok(
      memIdx < catchIdx,
      "in-memory mirror must live BEFORE the catch — otherwise a storage throw leaves the in-memory key set and the user passes verify but loses the key on reload",
    );
  });
});

/* ---------- mutation guard: setPrimaryResume happy path ----- */

describe("user-content-store — setPrimaryResume happy path", () => {
  it("writes the new record when put succeeds", async () => {
    const { UC, stores } = loadStore();
    stores.resumeVersions.data.set("__primary__", {
      id: "__primary__",
      extractedText: "OLD",
      label: "Old",
      source: "saved",
      rawMime: null,
      structured: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    const rec = await UC.setPrimaryResume({
      extractedText: "NEW resume",
      label: "New",
    });
    assert.equal(rec.extractedText, "NEW resume");
    const stored = stores.resumeVersions.data.get("__primary__");
    assert.equal(stored.extractedText, "NEW resume");
    // activeResumeId pointer must also have been written.
    assert.equal(
      stores.settings.data.get("activeResumeId").value,
      "__primary__",
    );
  });
});
