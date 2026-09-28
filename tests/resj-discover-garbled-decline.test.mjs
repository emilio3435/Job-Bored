import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   RESJ K3 review fix K3-RUN (Grok, 1caa65dc): Settings →
   Discover saved the textarea through the garble check, and on
   "Keep my current resume" still posted that broken text to the
   discovery worker. A declined confirm now stops the run: nothing
   is sent, and the error line says why. Fictional text only.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
/* The module leaves long timers (request aborts, polling); unref them so
 * the test process can exit. */
const quietTimeout = (fn, ms) => {
  const t = setTimeout(fn, ms);
  if (t && typeof t.unref === "function") t.unref();
  return t;
};

const BROKEN = "S ummary Nine years in marketing . E xperience Director of Growth .";

function fakeEl(extra = {}) {
  const listeners = {};
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: true,
    disabled: false,
    checked: false,
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    _listeners: listeners,
    ...extra,
  };
}

/** @param {{ confirmSave: boolean }} opts */
async function runDiscover({ confirmSave }) {
  const els = {
    settingsProfileResumeText: fakeEl({ value: BROKEN }),
    settingsProfileRunBtn: fakeEl(),
    settingsProfileError: fakeEl(),
    settingsProfileResults: fakeEl(),
    settingsProfileSpinner: fakeEl(),
  };
  const document = {
    readyState: "loading",
    addEventListener() {},
    getElementById: (id) => els[id] || null,
    createElement: () => fakeEl(),
    body: { appendChild() {}, removeChild() {} },
    dispatchEvent() {},
  };
  const fetchCalls = [];
  const saves = [];
  const window = {
    setTimeout: quietTimeout,
    clearTimeout,
    location: { hostname: "localhost", port: "8080", protocol: "http:", origin: "http://localhost:8080" },
    COMMAND_CENTER_CONFIG: { discoveryWebhookUrl: "http://127.0.0.1:39998/webhook" },
    CommandCenterUserContent: {
      openDb: async () => {},
      getActiveResume: async () => null,
      savePrimaryResumeChecked: async (payload) => {
        saves.push(payload);
        return confirmSave ? { id: "__primary__", serverSync: Promise.resolve({ ok: true }) } : null;
      },
      describeResumeServerSync: () => "",
    },
  };
  const context = {
    window,
    document,
    console,
    URL,
    AbortController,
    setTimeout: quietTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { userAgent: "Mozilla/5.0", platform: "MacIntel" },
    fetch: async (url, init) => {
      fetchCalls.push({ url: String(url), body: init && init.body ? String(init.body) : "" });
      return { ok: false, status: 503, json: async () => ({ ok: false, message: "stub" }) };
    },
  };
  vm.createContext(context);
  vm.runInContext(await readFile(join(repoRoot, "config-overrides.js"), "utf8"), context, { filename: "config-overrides.js" });
  vm.runInContext(await readFile(join(repoRoot, "settings-profile-tab.js"), "utf8"), context, {
    filename: "settings-profile-tab.js",
  });
  window.JobBoredSettingsProfileTab.bind();
  await els.settingsProfileRunBtn._listeners.click();
  return { saves, fetchCalls, error: els.settingsProfileError.textContent };
}

describe("Discover stops when the user keeps their resume over broken text (K3-RUN)", () => {
  it("should send nothing and say why when the garble confirm is declined", async () => {
    const { saves, fetchCalls, error } = await runDiscover({ confirmSave: false });
    assert.equal(saves.length, 1, "the save went through the garble check");
    assert.deepEqual(
      fetchCalls.filter((c) => c.body.includes("E xperience")),
      [],
      "the broken text never left the browser",
    );
    assert.match(error, /didn't run/);
    assert.match(error, /Paste clean text or upload the \.docx/);
  });

  it("should still run when the user confirms the save", async () => {
    const { fetchCalls } = await runDiscover({ confirmSave: true });
    assert.ok(fetchCalls.some((c) => c.body.includes("E xperience")), JSON.stringify(fetchCalls.map((c) => c.url)));
  });
});
