import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { detectGarbledResume } from "../server/materials-resume-source.mjs";

/* ============================================================
   RESJ K3: garbled PDF text never silently becomes the resume.

   A generated PDF whose text layer splits words ("S ummary",
   "10 M +") used to be saved as-is. The browser now runs the
   drafter's garble detector at ingest; flagged text is saved only
   after an explicit "Save it anyway", and never reaches the
   server's resume.txt. Fictional text only.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ingestJs = readFileSync(join(repoRoot, "resume-ingest.js"), "utf8");
const storeJs = readFileSync(join(repoRoot, "user-content-store.js"), "utf8");
const FIXTURE_GARBLED = readFileSync(join(repoRoot, "tests", "fixtures", "materials-garbled-resume.txt"), "utf8");

/* Shaped like the broken extraction: the whole header and summary on one
 * 700-character line, capitals split off their words, figures split from
 * their units. */
const SPLIT_WORD = [
  "JORDAN RIVERA Growth Marketing Leader Austin , TX | ( 512 ) 555 -0147 | jordan.rivera@example.com S ummary " +
    "Nine years in performance marketing . Grew a $ 10 M + paid book to a top -3 ranking across Google Ads ( Search , " +
    "YouTube ) , Meta Ads , and CTV . Cut CAC 18 % in one year and doubled pipeline for Northwind Outfitters . E xperience " +
    "Director of Growth , Northwind Outfitters , 2019 to 2025 . Built the lifecycle program , the attribution model , and a " +
    "team of six . S kills Paid search , lifecycle email , SQL , Looker .",
  "E ducation B.A. Economics , Lakeview State University .",
].join("\n");

const CLEAN = `Jordan Rivera
Growth Marketing Leader
Austin, TX | (512) 555-0147 | jordan.rivera@example.com

Summary
Nine years in performance marketing. Grew a $12M+ paid book to a top-4 ranking.
`;

const NICKNAME = `JORDAN “JO” RIVERA
Growth Marketing Leader · AI Product Builder
Austin, TX | (512) 555-0147 | linkedin.com/in/jordan-rivera
`;

function loadIngest() {
  const window = {};
  const ctx = { window, document: {}, console, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(ingestJs, ctx, { filename: "resume-ingest.js" });
  return window.CommandCenterResumeIngest;
}

describe("the browser garble detector matches the drafter's (RESJ K3)", () => {
  const ingest = loadIngest();
  for (const [name, text] of [
    ["the split-word extraction", SPLIT_WORD],
    ["the materials garbled fixture", FIXTURE_GARBLED],
    ["a clean resume", CLEAN],
    ["a clean resume with a nickname", NICKNAME],
    ["empty text", ""],
  ]) {
    it(`should score ${name} exactly as server/materials-resume-source.mjs does`, () => {
      assert.equal(typeof ingest.detectGarbledText, "function");
      assert.deepEqual(JSON.parse(JSON.stringify(ingest.detectGarbledText(text))), detectGarbledResume(text));
    });
  }

  it("should flag the split-word extraction and pass the clean resume", () => {
    assert.equal(ingest.detectGarbledText(SPLIT_WORD).garbled, true);
    assert.equal(ingest.detectGarbledText(CLEAN).garbled, false);
  });
});

/* ---------- the store's guard ------------------------------------ */

function fakeIndexedDb() {
  const stores = new Map();
  const storeOf = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const db = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction(name) {
      const data = storeOf(name);
      const tx = {
        oncomplete: null,
        onabort: null,
        onerror: null,
        objectStore() {
          const req = (fn) => {
            const r = { onsuccess: null, onerror: null, result: null };
            queueMicrotask(() => {
              r.result = fn();
              if (r.onsuccess) r.onsuccess();
            });
            return r;
          };
          return {
            clear: () => req(() => data.clear()),
            put: (rec) => req(() => data.set(rec.id != null ? rec.id : rec.key, rec)),
            get: (key) => req(() => data.get(key) || null),
            getAll: () => req(() => Array.from(data.values())),
            delete: (key) => req(() => data.delete(key)),
          };
        },
        abort() {},
      };
      setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
      return tx;
    },
  };
  return {
    stores,
    indexedDB: {
      open() {
        const r = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db };
        queueMicrotask(() => r.onsuccess && r.onsuccess());
        return r;
      },
    },
  };
}

/** @param {{ confirmAnswer?: boolean }} [options] */
function loadStoreWithIngest({ confirmAnswer = false } = {}) {
  const idb = fakeIndexedDb();
  const puts = [];
  const dialogs = [];
  const window = {
    location: { protocol: "http:" },
    COMMAND_CENTER_CONFIG: {},
    JobBoredA11y: {
      dialog: {
        confirm: async (spec) => {
          dialogs.push(spec);
          return { confirmed: confirmAnswer, values: {} };
        },
      },
    },
  };
  const ctx = {
    window,
    document: {},
    console,
    indexedDB: idb.indexedDB,
    crypto: { randomUUID: () => "uuid" },
    setTimeout,
    clearTimeout,
    AbortController,
    queueMicrotask,
    Date,
    fetch: async (url, init) => {
      puts.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(ingestJs, ctx, { filename: "resume-ingest.js" });
  vm.runInContext(storeJs, ctx, { filename: "user-content-store.js" });
  const primary = () => (idb.stores.get("resumeVersions") || new Map()).get("__primary__");
  return { UC: window.CommandCenterUserContent, primary, puts, dialogs };
}

describe("setPrimaryResume refuses garbled text without an explicit confirm (RESJ K3)", () => {
  it("should throw resume_garbled and keep the good resume", async () => {
    const { UC, primary, puts } = loadStoreWithIngest();
    await UC.setPrimaryResume({ source: "paste", extractedText: CLEAN });
    await assert.rejects(
      UC.setPrimaryResume({ source: "file", rawMime: "application/pdf", extractedText: SPLIT_WORD }),
      (err) => err.code === "resume_garbled" && /paste the text or upload the \.docx/i.test(err.message),
    );
    assert.equal(primary().extractedText, CLEAN.trim(), "the good resume is still the primary one");
    assert.equal(puts.length, 1, "nothing garbled was sent to the server");
  });

  it("should save flagged text when the caller passes the user's confirm", async () => {
    const { UC, primary } = loadStoreWithIngest();
    await UC.setPrimaryResume({ source: "file", extractedText: SPLIT_WORD, confirmGarbled: true });
    assert.equal(primary().extractedText, SPLIT_WORD);
  });
});

describe("savePrimaryResumeChecked asks before saving broken text (RESJ K3)", () => {
  it("should keep the current resume when the user declines", async () => {
    const { UC, primary, dialogs } = loadStoreWithIngest({ confirmAnswer: false });
    await UC.setPrimaryResume({ source: "paste", extractedText: CLEAN });
    const result = await UC.savePrimaryResumeChecked({ source: "file", rawMime: "application/pdf", extractedText: SPLIT_WORD });
    assert.equal(result, null, "declined: nothing saved");
    assert.equal(primary().extractedText, CLEAN.trim());
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].title, "This PDF's text came out broken");
    assert.match(dialogs[0].body, /Paste the text or upload the \.docx instead\./);
    assert.match(dialogs[0].body, /replaces the resume you have now/);
    assert.equal(dialogs[0].confirmLabel, "Save it anyway");
    assert.equal(dialogs[0].cancelLabel, "Keep my current resume");
  });

  it("should save it after the user confirms", async () => {
    const { UC, primary } = loadStoreWithIngest({ confirmAnswer: true });
    const result = await UC.savePrimaryResumeChecked({ source: "file", rawMime: "application/pdf", extractedText: SPLIT_WORD });
    assert.ok(result);
    assert.equal(primary().extractedText, SPLIT_WORD);
  });

  it("should save clean text without asking", async () => {
    const { UC, primary, dialogs } = loadStoreWithIngest();
    await UC.savePrimaryResumeChecked({ source: "paste", extractedText: CLEAN });
    assert.equal(primary().extractedText, CLEAN.trim());
    assert.equal(dialogs.length, 0);
  });
});

describe("every resume upload surface goes through the check (RESJ K3)", () => {
  it("oneflow-beat-resume.js saves no resume at upload at all (JOBQA: B4's commit does)", () => {
    const src = readFileSync(join(repoRoot, "oneflow-beat-resume.js"), "utf8");
    assert.doesNotMatch(src, /savePrimaryResumeChecked\(|\.setPrimaryResume\(/);
  });
  for (const file of ["profile-materials.js", "materials-feature.js", "settings-profile-tab.js"]) {
    it(`${file} should save the primary resume through savePrimaryResumeChecked`, () => {
      const src = readFileSync(join(repoRoot, file), "utf8");
      assert.match(src, /savePrimaryResumeChecked\(/);
      assert.doesNotMatch(src, /\.setPrimaryResume\(\{/, "no direct unchecked save left");
    });
  }
});

/* ---------- the server's other writer of resume.txt --------------- */

describe("POST /profile/from-resume never caches garbled text over resume.txt (RESJ K3)", () => {
  const home = mkdtempSync(join(tmpdir(), "jobbored-k3-home-"));
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  });

  it("should leave the saved clean resume in place", async () => {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    mkdirSync(join(home, ".jobbored"), { recursive: true });
    const path = join(home, ".jobbored", "resume.txt");
    writeFileSync(path, CLEAN);
    const { resolveResumeTextForAnalysis } = await import("../server/profile-from-resume.mjs");
    // JOBQA: parsing is read-only and garbled text is refused, never cached
    // and never swapped for the saved resume.
    await assert.rejects(resolveResumeTextForAnalysis({ resumeText: SPLIT_WORD }), { code: "resume_garbled" });
    assert.ok(existsSync(path));
    assert.equal(readFileSync(path, "utf8"), CLEAN);
  });
});
