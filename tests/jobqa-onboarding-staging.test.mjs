/**
 * JOBQA: onboarding stages everything in the browser draft and never reads
 * or writes the setup saved on this computer before its one commit; drafts
 * stay with the Google account they were typed under.
 *
 * Browser state only (the vm harness). The profile/voice libraries are
 * spies, so each test sees exactly what a beat asked to read or write.
 * Synthetic people only (tests/fixtures/jobqa-hermetic/profiles.mjs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { createProfileCommitService } from "../server/profile-commit.mjs";
import { loadArrival, makeFetchDouble } from "./oneflow-l1-harness.mjs";
import { loadOneFlow } from "./oneflow-l0-harness.mjs";
import { ALEX, MORGAN, accountHashOf, manifestOf, morganSavedProfile, seedStore, storePaths } from "./fixtures/jobqa-hermetic/profiles.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) await tick();
}

function identityLib(calls, options = {}) {
  return {
    renderForm(root, config) {
      let values = config.values ? { ...config.values } : {};
      const form = {
        root,
        getValues: () => ({ ...values }),
        setValues(next, opts = {}) {
          for (const [key, value] of Object.entries(next || {})) {
            if (opts.onlyEmpty && values[key]) continue;
            values[key] = value;
          }
        },
        getProvenance: () => ({}),
        restoreProvenance() {},
        showErrors() {},
        focusFirstInvalid() {},
        markClean() {},
        /** Test helper: the user types into a field. */
        type(key, value) {
          values[key] = value;
          if (config.onChange) config.onChange();
        },
      };
      calls.forms.push(form);
      return form;
    },
    async fetchSaved() {
      calls.fetchSaved += 1;
      return { exists: true, contact: { fullName: "Morgan Existing", phone: MORGAN.phone } };
    },
    async suggest(text) {
      calls.suggest.push(text);
      if (options.suggest) return options.suggest(text);
      return { values: { fullName: "Alex Example", email: ALEX.email }, suggestions: {} };
    },
    async save() {
      calls.save += 1;
      return { ok: true };
    },
    toValues: (v) => ({ ...v }),
    toContact: (v) => ({ ...v }),
    validate: () => [],
    confidenceOf: () => ({}),
  };
}

function voiceLib(env, calls) {
  return {
    renderPromptBox() {},
    filePicker() {
      return { button: env.document.createElement("button"), input: env.document.createElement("input") };
    },
    async readTextFile() {
      return { ok: false, message: "not in this test" };
    },
    renderGuideField(root, config) {
      let text = config.value || "";
      const fieldRoot = env.document.createElement("div");
      fieldRoot.appendChild(env.document.createElement("label"));
      root.appendChild(fieldRoot);
      const field = {
        root: fieldRoot,
        textarea: env.document.createElement("textarea"),
        getText: () => text,
        setText(next) {
          text = next;
          if (config.onChange) config.onChange(next);
        },
      };
      calls.fields.push(field);
      return field;
    },
    async fetchVoice() {
      calls.fetchVoice += 1;
      return { ok: true, exists: true, text: MORGAN.voice, updatedAt: "2026-09-01T00:00:00.000Z", words: 12 };
    },
    async saveVoice() {
      calls.saveVoice += 1;
      return { ok: true };
    },
    problemMessage: () => "That guide can't be used.",
    formatDate: () => "",
  };
}

/**
 * The arrival sandbox plus the details/voice beats, spy libraries and a
 * signed-in account. Seeded drafts belong to that account (`owned`), as they
 * do in real onboarding once the Google beat signed in.
 */
async function arrive({ email = ALEX.email, flowState = {}, suggest, owned = true } = {}) {
  const env = loadArrival({
    extraFiles: ["oneflow-beat-details.js", "oneflow-beat-voice.js"],
    fetchImpl: makeFetchDouble(() => ({ ok: true, json: { ok: true } })),
  });
  env.window.crypto = globalThis.crypto;
  env.window.TextEncoder = TextEncoder;
  const who = { email };
  env.window.JobBoredApp.auth = { getUserEmail: () => who.email };
  const calls = { fetchSaved: 0, suggest: [], save: 0, forms: [], fetchVoice: 0, saveVoice: 0, fields: [] };
  env.window.JobBoredProfileIdentity = identityLib(calls, { suggest });
  env.window.JobBoredProfileVoice = voiceLib(env, calls);
  env.window.JobBoredProfileVoiceShared = {
    voiceProblem: (t) => (String(t || "").trim() ? "" : "empty"),
    countWords: (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length,
  };
  await env.store.saveOnboardingFlowState({
    completedBeats: ["google", "ai", "resume"],
    ...(owned ? { accountHash: accountHashOf(email) } : {}),
    ...flowState,
  });
  return { env, calls, who };
}

const mutating = (env) =>
  env.fetchImpl.calls.filter((c) => {
    const method = String((c.options && c.options.method) || "GET").toUpperCase();
    return method !== "GET" && !/\/profile\/(from-resume|contact\/suggest)$/.test(c.url);
  });

describe("LOCALFIX saved setup adoption", () => {
  async function savedSetup(t, { email = MORGAN.email, unowned = false, onResume } = {}) {
    const root = await mkdtemp(join(tmpdir(), "localfix-adopt-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const paths = storePaths(join(root, "store"));
    await seedStore(paths, "existing");
    if (unowned) await rm(paths.record);
    const service = createProfileCommitService({ paths });
    const env = loadArrival();
    new Function("window", readFileSync(join(REPO, "fit-profile-schema.js"), "utf8"))(env.window);
    env.window.crypto = globalThis.crypto;
    env.window.TextEncoder = TextEncoder;
    const who = { email };
    env.window.JobBoredApp.auth = { getUserEmail: () => who.email };
    const calls = [];
    env.window.fetch = async (url, init) => {
      calls.push({ url, method: init.method, ...(init.body ? { body: JSON.parse(init.body) } : {}) });
      let data;
      if (url.endsWith("/profile/commit/state")) data = { ok: true, ...(await service.state()) };
      else if (url.endsWith("/profile/resume")) {
        if (onResume) await onResume({ paths, who });
        data = { ok: true, resumeText: await service.savedResume() };
      } else if (url.endsWith("/profile")) data = await service.exclusive(async () => ({ ok: true, profile: JSON.parse(await readFile(paths.profile, "utf8")) }));
      else if (url.endsWith("/profile/commit")) data = { ok: false, reason: "replace_proof_mismatch" };
      else throw new Error(`unexpected fixture request: ${url}`);
      return { ok: data.ok, status: data.ok ? 200 : 409, json: async () => data };
    };
    const completions = [];
    const messages = [];
    const scope = { current: "saved#1" };
    const ctx = {
      state: {}, scope: "saved#1", accountHash: accountHashOf(email),
      isCurrentScope: (value) => value === scope.current,
      runtime: { profileDraft: morganSavedProfile(), drafts: {} },
      saveDraft: (key, value) => { ctx.runtime.drafts[key] = value; },
      setMessage: (text, tone) => messages.push({ text, tone }),
      setBusy() {}, clearBusy() {}, completeBeat: async (data) => completions.push(data),
    };
    const beat = env.flow.getBeat("fit");
    const container = env.document.createElement("div");
    beat.render(container, ctx);
    await settle();
    return { env, beat, ctx, container, calls, completions, messages, scope, root, who, paths };
  }

  for (const unowned of [false, true]) {
    it(`W3 a fresh browser adopts ${unowned ? "an unowned" : "its account's"} saved setup without a canonical write`, async (t) => {
      const s = await savedSetup(t, { unowned });
      const before = await manifestOf(join(s.root, "store"));
      const offer = s.container.querySelector(".oneflow-fit-adopt");
      assert.ok(offer && !offer.hidden, "matching signed-in users get an explicit adoption action");
      await s.beat.onAction("adopt-saved-setup", s.ctx);
      assert.equal((await s.env.store.getActiveResume()).extractedText, MORGAN.resumeText);
      assert.equal(s.ctx.runtime.fitProfile.identity.fullName, "Morgan Existing");
      assert.equal(s.completions.length, 1);
      assert.equal(s.completions[0].syncReason, "adopted");
      assert.equal(s.calls.every((call) => call.method === "GET"), true);
      assert.deepEqual(await manifestOf(join(s.root, "store")), before);
    });
  }

  it("W3 a different account cannot read or adopt the saved profile and resume", async (t) => {
    const s = await savedSetup(t, { email: ALEX.email });
    await s.beat.onAction("adopt-saved-setup", s.ctx);
    assert.equal(await s.env.store.getActiveResume(), null);
    assert.equal(s.completions.length, 0);
    assert.equal(s.calls.some((call) => /\/profile(?:\/resume)?$/.test(call.url)), false);
  });

  it("W3 revisiting fit after adoption uses the saved setup rather than old staged answers", async (t) => {
    const s = await savedSetup(t);
    s.ctx.runtime.contactIdentity = { fullName: "Unsaved Fiction" };
    s.ctx.runtime.oneFlowFitReview.model.identity.targetRoles = ["Unsaved Fictional Role"];
    await s.beat.onAction("adopt-saved-setup", s.ctx);
    s.beat.render(s.env.document.createElement("div"), s.ctx);
    await s.beat.onAction("confirm-fit", s.ctx);
    const commit = s.calls.find((call) => call.method === "POST").body;
    assert.equal(commit.profile.identity.fullName, "Morgan Existing");
    assert.deepEqual(commit.profile.identity.targetRoles, ["Principal Platform Architect"]);
  });

  it("W3 an account switch while reading saves no browser copy", async (t) => {
    const s = await savedSetup(t, { onResume: ({ who }) => { who.email = ALEX.email; } });
    await s.beat.onAction("adopt-saved-setup", s.ctx);
    assert.equal(await s.env.store.getActiveResume(), null);
    assert.equal(s.completions.length, 0);
  });

  it("W3 a revision change during adoption saves no mixed browser copy", async (t) => {
    const s = await savedSetup(t, { onResume: ({ paths }) => writeFile(paths.resume, `${MORGAN.resumeText}\nChanged elsewhere.\n`) });
    await s.beat.onAction("adopt-saved-setup", s.ctx);
    assert.equal(await s.env.store.getActiveResume(), null);
    assert.equal(s.completions.length, 0);
    assert.ok(s.messages.some((m) => /changed/i.test(m.text)));
  });

  it("W4 drifted proof offers recovery without telling the user to reload and retry", async (t) => {
    const s = await savedSetup(t);
    s.ctx.runtime.drafts.resumeText = ALEX.resumeText;
    await s.beat.onAction("confirm-fit", s.ctx);
    const refusal = s.messages.find((m) => /nothing was replaced/i.test(m.text));
    assert.ok(refusal);
    assert.doesNotMatch(refusal.text, /reload/i);
    assert.match(refusal.text, /saved|Settings.*Resume/i);
    await s.beat.onAction("adopt-saved-setup", s.ctx);
    assert.equal(s.completions.length, 1);
  });
});

const detailsForm = (env) => env.window.JobBoredOneFlowBeatDetails.getForm();

describe("JOBQA details: only the staged resume fills the form", () => {
  it("should never read the saved profile, and fill only what the staged resume says", async () => {
    const { env, calls } = await arrive({ flowState: { drafts: { resumeText: ALEX.resumeText } } });
    await env.flow.open("details");
    await settle();
    assert.equal(calls.fetchSaved, 0, "GET /profile is never asked: it may be another person's");
    assert.deepEqual(calls.suggest, [ALEX.resumeText]);
    const values = detailsForm(env).getValues();
    assert.equal(values.fullName, "Alex Example");
    assert.equal(values.phone, undefined, "no saved phone fills the gap");
  });

  it("should keep confirmed details in the draft and save nothing", async () => {
    const { env, calls } = await arrive({ flowState: { drafts: { resumeText: ALEX.resumeText } } });
    await env.flow.open("details");
    await settle();
    await env.flow.getBeat("details").onAction("details_confirm", {
      ...env.flow,
      state: env.flow.getState(),
      runtime: { drafts: {} },
      saveDraft: (key, value) => env.flow.saveDraft(key, value),
      setMessage() {},
      setBusy() {},
      clearBusy() {},
      completeBeat: () => env.flow.completeBeat("details", {}),
      skipBeat() {},
    });
    await env.flow.flushDrafts();
    assert.equal(calls.save, 0, "POST /profile/contact is never sent during onboarding");
    assert.equal(env.flow.getState().drafts.contactDraft.confirmed, true);
    assert.deepEqual(mutating(env), []);
  });

  it("should drop everything typed under account A when account B takes the same page", async () => {
    const { env, who, calls } = await arrive({ email: MORGAN.email, flowState: { drafts: { resumeText: MORGAN.resumeText } } });
    await env.flow.open("details");
    await settle();
    assert.deepEqual(calls.suggest, [MORGAN.resumeText], "A's own staged resume filled A's form");
    detailsForm(env).type("phone", "(555) 222-3333");
    who.email = ALEX.email;
    await env.flow.goToBeat("details");
    await settle();
    const values = detailsForm(env).getValues();
    assert.equal(values.phone, undefined, "A's typed phone is not carried into B");
    assert.notEqual(values.fullName, "Alex Example", "B has no staged resume, so nothing was suggested");
    assert.notEqual(values.fullName, "Morgan Existing");
  });

  it("should drop a late suggestion that answers for the account that left", async () => {
    let answer;
    const late = new Promise((resolve) => {
      answer = resolve;
    });
    const { env, who } = await arrive({
      email: MORGAN.email,
      flowState: { drafts: { resumeText: MORGAN.resumeText } },
      suggest: () => late,
    });
    await env.flow.open("details");
    await tick();
    who.email = ALEX.email;
    await env.flow.goToBeat("details");
    answer({ values: { fullName: "Morgan Existing", phone: MORGAN.phone }, suggestions: {} });
    await settle();
    const values = detailsForm(env).getValues();
    assert.equal(values.fullName, undefined, "A's late answer never lands on B's form");
    assert.equal(values.phone, undefined);
  });
});

describe("JOBQA voice: the saved guide is never read, and nothing is saved here", () => {
  it("should start from the draft only and keep the guide in the draft", async () => {
    const { env, calls } = await arrive({ flowState: { completedBeats: ["google", "ai", "resume", "details"] } });
    await env.flow.open("voice");
    await settle();
    assert.equal(calls.fetchVoice, 0, "GET /profile/voice is never asked");
    calls.fields[calls.fields.length - 1].setText("# Alex's voice\n\nPlain and warm.");
    await env.flow.getBeat("voice").onAction("voice_save", {
      state: env.flow.getState(),
      runtime: env.flow.seedRuntime({}),
      saveDraft: (key, value) => env.flow.saveDraft(key, value),
      setMessage() {},
      setBusy() {},
      clearBusy() {},
      completeBeat: () => env.flow.completeBeat("voice", {}),
      skipBeat() {},
    });
    await env.flow.flushDrafts();
    assert.equal(calls.saveVoice, 0, "PUT /profile/voice is never sent during onboarding");
    assert.match(env.flow.getState().drafts.voiceDraft, /Alex's voice/);
    assert.deepEqual(mutating(env), []);
  });
});

describe("JOBQA drafts stay with their Google account", () => {
  it("should give an empty setup its first owner", async () => {
    const { env } = await arrive({ owned: false, flowState: {} });
    await env.flow.open("resume");
    assert.equal(env.flow.getState().accountHash, accountHashOf(ALEX.email));
  });

  it("should quarantine ownerless drafts from before, never adopt them into the next sign-in", async () => {
    const { env } = await arrive({ owned: false, flowState: { drafts: { resumeText: "Legacy resume typed before accounts were tracked." } } });
    await env.flow.open("resume");
    const state = await env.store.getOnboardingFlowState();
    assert.equal(state.accountHash, accountHashOf(ALEX.email));
    assert.equal(state.drafts.resumeText, undefined, "the legacy text is not loaded for this account");
    const scopes = Object.keys(state.quarantine);
    assert.equal(scopes.length, 1);
    assert.match(scopes[0], /^unowned-/);
    assert.match(state.quarantine[scopes[0]].drafts.resumeText, /Legacy resume/);
    assert.ok(env.host.__calls.some((c) => c.name === "showToast" && /kept separately/.test(String(c.args[0]))));
  });

  it("should keep another account's drafts for it, and give them back only to it", async () => {
    const { env, who } = await arrive({ email: MORGAN.email, flowState: {} });
    await env.flow.open("resume");
    env.flow.saveDraft("resumeText", MORGAN.resumeText);
    await env.flow.flushDrafts();
    who.email = ALEX.email;
    await env.flow.goToBeat("resume");
    assert.equal(env.flow.getState().drafts.resumeText, undefined, "B never sees A's resume");
    who.email = MORGAN.email;
    await env.flow.goToBeat("resume");
    assert.equal(env.flow.getState().drafts.resumeText, MORGAN.resumeText, "A gets A's resume back");
  });

  it("should keep every account's drafts, more than four of them", async () => {
    const { env, who } = await arrive({ flowState: {} });
    for (let i = 1; i <= 6; i += 1) {
      who.email = `person${i}@fixture.test`;
      await env.flow.goToBeat("resume");
      env.flow.saveDraft("resumeText", `Resume of person ${i}`);
      await env.flow.flushDrafts();
    }
    const state = await env.store.getOnboardingFlowState();
    assert.equal(Object.keys(state.quarantine).length, 5, "five other accounts kept, none evicted");
  });

  it("should make no saving request while staging, reopening (a reload) or closing", async () => {
    const { env } = await arrive({ flowState: {} });
    await env.flow.open("resume");
    await env.beats.resume.ingestText(ALEX.resumeText, "paste");
    await env.flow.open("details");
    await settle();
    env.flow.close();
    await env.flow.open("details");
    await settle();
    assert.deepEqual(mutating(env), [], "only read-only parsing reached the server");
    assert.equal(await env.store.getActiveResume(), null, "the browser's saved resume is untouched");
  });
});

describe("JOBQA fit: a confirm never lands in another account's setup", () => {
  function fitSetup({ onCommit } = {}) {
    const env = loadOneFlow({ beatFiles: true });
    new Function("window", readFileSync(join(REPO, "fit-profile-schema.js"), "utf8"))(env.window);
    env.window.crypto = globalThis.crypto;
    env.window.TextEncoder = TextEncoder;
    const who = { email: ALEX.email };
    env.window.JobBoredApp = { auth: { getUserEmail: () => who.email } };
    const writes = { discovery: 0, primary: 0 };
    env.window.CommandCenterUserContent.saveDiscoveryProfile = async (p) => {
      writes.discovery += 1;
      return p;
    };
    env.window.CommandCenterUserContent.setPrimaryResume = async (p) => {
      writes.primary += 1;
      return p;
    };
    const scope = { current: "A#1" };
    const commits = [];
    env.window.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      commits.push(body);
      if (onCommit) onCommit(scope, who);
      return { ok: true, status: 200, json: async () => ({ ok: true, commitId: body.commitId, revision: "r1" }) };
    };
    const beat = env.flow.getBeat("fit");
    const completions = [];
    const messages = [];
    const ctx = {
      state: {},
      scope: "A#1",
      accountHash: "",
      isCurrentScope: (s) => s === scope.current,
      runtime: {
        profileDraft: {
          version: 1,
          identity: { targetRoles: ["Analyst"], targetSeniority: "any", primaryNarrative: "Operations analyst who turns intake queues into dashboards." },
          strengths: [{ name: "SQL", rank: 1 }],
          hardConstraints: { workMode: "any" },
        },
        drafts: { resumeText: ALEX.resumeText },
      },
      setMessage: (text, tone) => messages.push({ text, tone }),
      setBusy() {},
      clearBusy() {},
      completeBeat: async (d) => completions.push(d),
    };
    beat.render(env.document.createElement("div"), ctx);
    return { env, beat, ctx, who, writes, commits, completions, messages, scope };
  }

  it("should write nothing in the browser when the account switched while the commit was in flight", async () => {
    const t = fitSetup({
      onCommit: (scope) => {
        scope.current = "B#2";
      },
    });
    t.ctx.accountHash = accountHashOf(ALEX.email);
    await t.beat.onAction("confirm-fit", t.ctx);
    assert.equal(t.commits.length, 1);
    assert.equal(t.writes.discovery, 0, "A's answer is never applied to B's browser state");
    assert.equal(t.writes.primary, 0);
    assert.equal(t.completions.length, 0);
  });

  it("should refuse to save answers typed under another account than the one signed in", async () => {
    const t = fitSetup();
    t.ctx.accountHash = accountHashOf(MORGAN.email);
    await t.beat.onAction("confirm-fit", t.ctx);
    assert.equal(t.commits.length, 0, "nothing is sent");
    assert.ok(t.messages.some((m) => m.tone === "error" && /different Google account/.test(m.text)));
  });
});

describe("JOBQA fit: a retry after a failed browser copy replays the save it already made", () => {
  it("should replay (not refuse) when the retry comes back as a replace under the same id", async () => {
    // The real commit service on a temp store, the real browser store on a
    // fake IndexedDB: the first confirm commits and writes the browser's
    // primary resume, then the discovery save fails; the retry now holds
    // that resume, so it asks for replace — and must replay.
    const root = await mkdtemp(join(tmpdir(), "jobqa-fit-retry-"));
    try {
      const paths = storePaths(join(root, "store"));
      await seedStore(paths, "empty");
      const service = createProfileCommitService({ paths });
      // loadArrival's fake IndexedDB carries the resume store's one-transaction
      // clear()+put(), so setPrimaryResume and getActiveResume are real here.
      const env = loadArrival();
      new Function("window", readFileSync(join(REPO, "fit-profile-schema.js"), "utf8"))(env.window);
      env.window.crypto = globalThis.crypto;
      env.window.TextEncoder = TextEncoder;
      env.window.JobBoredApp.auth = { getUserEmail: () => ALEX.email };
      const bodies = [];
      const answers = [];
      env.window.fetch = async (url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        try {
          const result = await service.commit(body);
          answers.push(result);
          return { ok: true, status: 200, json: async () => result };
        } catch (err) {
          answers.push({ ok: false, reason: err.reason });
          return { ok: false, status: err.status || 500, json: async () => ({ ok: false, reason: err.reason, message: err.message }) };
        }
      };
      let failDiscovery = true;
      const saveDiscovery = env.window.CommandCenterUserContent.saveDiscoveryProfile;
      env.window.CommandCenterUserContent.saveDiscoveryProfile = async (payload) => {
        if (failDiscovery) {
          failDiscovery = false;
          throw new Error("quota exceeded");
        }
        return saveDiscovery(payload);
      };
      const completions = [];
      const messages = [];
      const ctx = {
        state: {},
        scope: "alex#1",
        accountHash: accountHashOf(ALEX.email),
        isCurrentScope: () => true,
        runtime: {
          profileDraft: {
            version: 1,
            identity: { targetRoles: ["Analyst"], targetSeniority: "any", primaryNarrative: "Operations analyst who turns intake queues into dashboards." },
            strengths: [{ name: "SQL", rank: 1 }],
            hardConstraints: { workMode: "any" },
          },
          drafts: { resumeText: ALEX.resumeText },
        },
        setMessage: (text, tone) => messages.push({ text, tone }),
        setBusy() {},
        clearBusy() {},
        completeBeat: async (d) => completions.push(d),
      };
      const beat = env.flow.getBeat("fit");
      beat.render(env.document.createElement("div"), ctx);

      await beat.onAction("confirm-fit", ctx);
      assert.equal(bodies[0].mode, "create");
      assert.equal(answers[0].ok, true);
      const held = await env.store.getActiveResume();
      assert.equal(held && held.extractedText, ALEX.resumeText.trim(), "the browser kept its primary copy before the discovery save failed");
      assert.equal(completions.length, 0, "the failed browser copy keeps the beat retryable");
      assert.ok(messages.some((m) => /saved on this computer/i.test(m.text)));

      await beat.onAction("confirm-fit", ctx);
      assert.equal(bodies[1].mode, "replace", "the browser now holds the committed resume");
      assert.equal(bodies[1].commitId, bodies[0].commitId);
      assert.equal(answers[1].ok, true, JSON.stringify(answers[1]));
      assert.equal(answers[1].replayed, true, "replayed, never commit_id_reused");
      assert.equal(completions.length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("JOBQA materials queue: a browser that never finished setup shows no queue", () => {
  function loadQueue(finished) {
    const requests = [];
    const region = {
      attrs: { hidden: "hidden" },
      innerHTML: "",
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      removeAttribute(k) {
        delete this.attrs[k];
      },
      hasAttribute(k) {
        return k in this.attrs;
      },
      getAttribute(k) {
        return this.attrs[k];
      },
      addEventListener() {},
      querySelectorAll: () => [],
    };
    const document = {
      readyState: "complete",
      querySelector: (sel) => (sel === '[data-region="materials-queue"]' ? region : null),
      querySelectorAll: () => [],
      addEventListener() {},
    };
    const window = {
      COMMAND_CENTER_CONFIG: { jobPostingScrapeUrl: "http://127.0.0.1:18681" },
      CommandCenterUserContent: { isOnboardingComplete: async () => finished },
      addEventListener() {},
    };
    const fetch = async (url) => {
      requests.push(url);
      return {
        ok: true,
        json: async () => ({ queue: [{ slug: "harbor-staff-sre", company: "Harbor Freightline Labs", title: "Staff SRE", feature: "cover_letter" }] }),
      };
    };
    const ctx = { window, document, fetch, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, console };
    vm.createContext(ctx);
    vm.runInContext(readFileSync(join(REPO, "materials-queue.js"), "utf8"), ctx);
    return { requests, region };
  }

  it("should neither fetch nor show the queue (or its Cancel buttons) before setup finished here", async () => {
    const q = loadQueue(false);
    await settle();
    assert.deepEqual(q.requests, []);
    assert.equal(q.region.hasAttribute("hidden"), true);
    assert.doesNotMatch(q.region.innerHTML, /Harbor/);
  });

  it("should fetch and show it once setup finished in this browser", async () => {
    const q = loadQueue(true);
    await settle();
    assert.equal(q.requests.length, 1);
    assert.match(q.requests[0], /\/api\/applications\/queue$/);
  });
});
