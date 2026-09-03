import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadOneFlow } from "./oneflow-l0-harness.mjs";

/* ============================================================
   GREENFIELD lane B — the Beat 3 draft mirror (spec §1 F2, §4.2).

   The greenfield walkthrough pasted a resume into Beat 3, hit Escape,
   reloaded, and got an empty textarea back. Persistence was not missing:
   it was asynchronous and single-pathed. Saves fired on `input` alone,
   the IndexedDB write was debounced 400 ms behind it, and the flow's
   close path fired `flushDrafts()` without awaiting it — so every route
   out of the beat had a window in which the typed text existed only in
   an IndexedDB transaction nobody was waiting on.

   §4.2 closes that window with a synchronous localStorage mirror:
   one key, `{ text, at }`, written before the debounce, preferred on
   hydrate, and cleared only by the flow's own reset path.

   These probes are the node half. The real-browser half — type, Escape,
   reload — is tests/e2e-visual/greenfield-b3-reload.spec.mjs (claim B4).
   ============================================================ */

const MIRROR_KEY = "jb_oneflow_draft_resumeText";
const PASTE_ID = "#oneFlowResumePaste";

/** The two-line localStorage the browser gives us and the sandbox does not. */
function fakeLocalStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/**
 * The substrate plus the six beats, with the two browser surfaces the
 * sandbox omits: localStorage (the mirror's home) and a toast bridge
 * (so the pause line is observable).
 */
function loadFlowWithStorage() {
  const env = loadOneFlow({ beatFiles: true });
  const local = fakeLocalStorage();
  env.window.localStorage = local;
  const toasts = [];
  env.window.JobBoredApp = {
    core: {
      host: {
        showToast(message, tone) {
          toasts.push({ message, tone, seq: env.seq() });
        },
      },
    },
  };
  const order = { n: 0 };
  env.seq = () => ++order.n;
  return { ...env, local, toasts, seq: env.seq };
}

/** What the mirror holds right now, parsed. */
function mirror(env) {
  const raw = env.local.getItem(MIRROR_KEY);
  return raw == null ? null : JSON.parse(raw);
}

/**
 * Render Beat 3 against the REAL controller seam, so a probe exercises
 * the same saveDraft the browser calls rather than a stub of it.
 */
function renderResume(env, drafts = {}) {
  const beat = env.flow.getBeat("resume");
  const container = env.document.createElement("div");
  const saved = [];
  beat.render(container, {
    state: { completedBeats: [] },
    runtime: { drafts },
    setMessage() {},
    setBusy() {},
    clearBusy() {},
    saveDraft(key, value) {
      saved.push({ key, value });
      return env.flow.saveDraft(key, value);
    },
    async completeBeat() {},
    async goToBeat() {},
  });
  return { container, saved, box: container.querySelector(PASTE_ID) };
}

const RESUME = "Emilio — Staff Engineer\nAustin, TX\n" + "Shipped platforms. ".repeat(20);

describe("GREENFIELD B1 — every path into the paste box saves (spec §4.2)", () => {
  it("B1-EVENTS-SAVE: input, change and paste each call saveDraft(\"resumeText\", …)", () => {
    const env = loadFlowWithStorage();
    const { box, saved } = renderResume(env);
    assert.ok(box, "Beat 3 must render #oneFlowResumePaste");

    box.value = `${RESUME} typed`;
    box.dispatch("input", {});
    box.value = `${RESUME} changed`;
    box.dispatch("change", {});
    box.value = `${RESUME} pasted`;
    box.dispatch("paste", {});

    const keys = saved.map((s) => s.key);
    assert.deepEqual(
      keys,
      ["resumeText", "resumeText", "resumeText"],
      "F2: a resume that arrived by paste or by a programmatic set was never saved — only typing was",
    );
    assert.equal(saved[0].value, `${RESUME} typed`);
    assert.equal(saved[1].value, `${RESUME} changed`);
    assert.equal(saved[2].value, `${RESUME} pasted`);
  });

  it("B1-MIRROR-SYNC: the mirror holds { text, at } before the 400 ms debounce fires", () => {
    const env = loadFlowWithStorage();
    const { box } = renderResume(env);

    box.value = RESUME;
    box.dispatch("input", {});

    // No await between the event and this read: that is the whole point.
    const held = mirror(env);
    assert.ok(held, `${MIRROR_KEY} must exist synchronously after the event`);
    assert.equal(held.text, RESUME, "the mirror carries the text, not a flag");
    assert.equal(
      Number.isFinite(held.at),
      true,
      "§4.2 locks the value shape at { text, at: Date.now() }",
    );
  });

  it("B1-MIRROR-SYNC-STATE: the IndexedDB copy is still empty at that moment", async () => {
    const env = loadFlowWithStorage();
    const { box } = renderResume(env);
    box.value = RESUME;
    box.dispatch("input", {});

    const stored = await env.store.getOnboardingFlowState();
    assert.equal(
      stored.drafts.resumeText,
      undefined,
      "the debounce is exactly the window F2 loses text in — the mirror is what covers it",
    );
    assert.equal(mirror(env).text, RESUME, "and the mirror already has it");
  });

  it("B1-MIRROR-CAP: the mirror caps at 100 000 chars, like the store it shadows", () => {
    const env = loadFlowWithStorage();
    const { box } = renderResume(env);
    box.value = "x".repeat(100001);
    box.dispatch("input", {});
    assert.equal(mirror(env).text.length, 100000);
  });

  it("B1-CONTROLLER-MIRRORS: flow.saveDraft mirrors even when the beat is not on screen", () => {
    const env = loadFlowWithStorage();
    env.flow.saveDraft("resumeText", RESUME);
    assert.equal(
      mirror(env).text,
      RESUME,
      "§4.2: written on EVERY saveDraft(\"resumeText\", …), which includes the file-upload path",
    );
    env.flow.saveDraft("profileDraft", { version: 1 });
    assert.equal(
      mirror(env).text,
      RESUME,
      "profileDraft is not mirrored — one key, and B4's drafted profile must not clobber it",
    );
  });
});

describe("GREENFIELD B2 — nothing unloads inside the write window (spec §4.2)", () => {
  it("B2-EXPORT: root.flushDrafts is a function", () => {
    const env = loadFlowWithStorage();
    assert.equal(
      typeof env.flow.flushDrafts,
      "function",
      "the unload paths need the flush the controller kept private",
    );
  });

  it("B2-CLOSE-AWAITS: handleShellClose lands the draft BEFORE the pause toast", async () => {
    const env = loadFlowWithStorage();
    const writes = [];
    const realSave = env.window.CommandCenterUserContent.saveOnboardingFlowState;
    env.window.CommandCenterUserContent.saveOnboardingFlowState = async (patch) => {
      const out = await realSave(patch);
      if (patch && patch.drafts) writes.push({ drafts: patch.drafts, seq: env.seq() });
      return out;
    };

    await env.flow.open("resume");
    writes.length = 0;
    env.toasts.length = 0;
    // Deliberately NOT awaited: the draft is inside the 400 ms debounce,
    // which is exactly the state Escape finds a half-typed resume in.
    env.flow.saveDraft("resumeText", `${RESUME} more`);

    await env.flow.close("escape");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(
      env.toasts.length,
      1,
      "Escape still speaks the pause — the toast is not what changed",
    );
    assert.ok(
      writes.length >= 1,
      "the half-typed resume has to be on disk before the flow says it is paused",
    );
    assert.ok(
      writes[0].seq < env.toasts[0].seq,
      "F2: the close path fired flushDrafts() and never waited for it",
    );
    const stored = await env.store.getOnboardingFlowState();
    assert.equal(stored.drafts.resumeText, `${RESUME} more`);
  });

  it("B2-PAGEHIDE: a pagehide event flushes the pending drafts", async () => {
    const env = loadFlowWithStorage();
    const listeners = [];
    env.window.addEventListener = (type, fn) => listeners.push({ type, fn });

    await env.flow.open("resume");
    await env.flow.saveDraft("resumeText", "seed");
    // The listener registers once, no matter how many drafts go by.
    env.flow.saveDraft("resumeText", `${RESUME} unloaded`);
    const pagehide = listeners.filter((l) => l.type === "pagehide");
    assert.equal(
      pagehide.length,
      1,
      "§4.2: one pagehide listener, registered once",
    );

    pagehide[0].fn({ type: "pagehide", persisted: false });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const stored = await env.store.getOnboardingFlowState();
    assert.equal(
      stored.drafts.resumeText,
      `${RESUME} unloaded`,
      "closing the tab mid-debounce is the F2 repro that never reaches handleShellClose",
    );
  });
});

describe("GREENFIELD B3 — hydrate prefers the mirror (spec §4.2)", () => {
  it("B3-MIRROR-ONLY: an empty drafts bag and a full mirror renders the mirror text", () => {
    const env = loadFlowWithStorage();
    env.local.setItem(
      MIRROR_KEY,
      JSON.stringify({ text: RESUME, at: Date.now() }),
    );
    const { box } = renderResume(env, {});
    assert.equal(
      box.value,
      RESUME,
      "the reload repro: IndexedDB never got the last burst, the mirror did",
    );
  });

  it("B3-MIRROR-WINS: with both present the mirror wins — it is never staler", () => {
    const env = loadFlowWithStorage();
    env.local.setItem(
      MIRROR_KEY,
      JSON.stringify({ text: "NEWER — typed after the last debounce", at: Date.now() }),
    );
    const { box } = renderResume(env, { resumeText: "OLDER — the landed copy" });
    assert.equal(box.value, "NEWER — typed after the last debounce");
  });

  it("B3-DRAFTS-STILL-WORK: with no mirror the drafts bag still hydrates", () => {
    const env = loadFlowWithStorage();
    const { box } = renderResume(env, { resumeText: "the landed copy" });
    assert.equal(box.value, "the landed copy");
  });

  it("B3-CLEAR: clearOnboardingFlowState removes the mirror key", async () => {
    const env = loadFlowWithStorage();
    env.flow.saveDraft("resumeText", RESUME);
    assert.ok(mirror(env), "precondition: the mirror is written");
    await env.store.clearOnboardingFlowState();
    assert.equal(
      env.local.getItem(MIRROR_KEY),
      null,
      "§4.2: the flow's single reset path is the ONLY thing that clears it",
    );
  });

  it("B3-CLEAR-ONLY-THERE: a beat transition does not clear the mirror", async () => {
    const env = loadFlowWithStorage();
    await env.flow.open("resume");
    await env.flow.saveDraft("resumeText", RESUME);
    await env.flow.goToBeat("fit");
    assert.equal(
      mirror(env).text,
      RESUME,
      "stale mirror text is harmless — hydrate only fills an EMPTY textarea",
    );
  });
});
