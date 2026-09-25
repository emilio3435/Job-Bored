/**
 * UX01 lane F · C22 (SS-20) — the setup doctor says what it will do
 * before it does it. renderInline lists each finding with the Sheet range
 * it would write, labels the button with the count, and when it stops for
 * the user it keeps the instructions next to Continue.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "setup-doctor.js"),
  "utf8",
);

function fakeDoc() {
  const mk = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      textContent: "",
      className: "",
      listeners: {},
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      get firstChild() { return this.children[0] || null; },
      addEventListener(t, fn) { (this.listeners[t] || (this.listeners[t] = [])).push(fn); },
      setAttribute() {},
    };
    return el;
  };
  return { createElement: mk, head: { appendChild() {} }, querySelector: () => null };
}

function text(el) {
  return [el.textContent, ...(el.children || []).map(text)].join(" ");
}

function load() {
  const doc = fakeDoc();
  const win = {
    location: { hostname: "localhost", origin: "http://localhost:8080", reload() {} },
    navigator: {},
    document: doc,
    fetch: () => Promise.reject(new Error("no fetch")),
    console,
    setTimeout,
  };
  const api = new Function("window", "globalThis", "module",
    src + "\n;return window.SetupDoctor;")(win, win, { exports: null });
  return { api, doc };
}

describe("UX01 SS-20 doctor preview", () => {
  it("lists what each fix will change before the Fix button", () => {
    const { api, doc } = load();
    const host = doc.createElement("div");
    api.renderInline(host, {
      issues: [
        { id: "pipeline_headers_wrong", title: "Pipeline headers are out of date", detail: "Columns moved.", autoFixable: true },
        { id: "popup_blocked", title: "Sign-in popup was blocked", detail: "Allow popups for this site.", autoFixable: false },
      ],
      _ctx: {},
    });
    const all = text(host);
    assert.match(all, /Pipeline headers are out of date/);
    assert.match(all, /Sign-in popup was blocked/);
    assert.match(all, /Will write Pipeline!A1/);
    assert.doesNotMatch(all, /Something’s off/);
    assert.match(all, /Fix 2 things/);
  });
});
