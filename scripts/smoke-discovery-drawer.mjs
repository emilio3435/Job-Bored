#!/usr/bin/env node
/**
 * Headless smoke test for the Discovery drawer consolidation work.
 *
 * Prereqs:
 *   - `npm run web-only` running at http://localhost:8080
 *   - macOS Chrome at /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
 *
 * Uses Chrome DevTools Protocol via the built-in Node WebSocket.
 * Exits non-zero if any assertion fails or any uncaught JS exception fires.
 */
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import http from "node:http";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:8080/index.html";
const RDP = 9333;

function getJSON(path, port) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path }, (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
        });
      })
      .on("error", reject);
  });
}

console.log("[smoke] launching headless Chrome…");
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${RDP}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--user-data-dir=/tmp/jb-smoke-profile",
    URL,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let chromeStderr = "";
chrome.stderr.on("data", (c) => (chromeStderr += c));

await wait(2500);
const tabs = await getJSON("/json", RDP);
const tab = Array.isArray(tabs) ? tabs.find((t) => t.url.includes("8080")) : null;
if (!tab) {
  console.error("[smoke] no tab found");
  console.error(chromeStderr.slice(-1500));
  chrome.kill();
  process.exit(2);
}

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let nextId = 0;
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    function onMsg(ev) {
      const msg = JSON.parse(ev.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", onMsg);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await call("Page.enable");
await call("Runtime.enable");
await wait(3500);

const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.exceptionThrown") {
    errors.push(
      m.params.exceptionDetails.exception?.description ||
        m.params.exceptionDetails.text,
    );
  }
});

async function evalExpr(expression) {
  const res = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      "eval threw: " +
        (res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text),
    );
  }
  return res.result.value;
}

const checks = [];
async function check(name, expression, expected = true) {
  try {
    const v = await evalExpr(expression);
    const ok = expected === "truthy" ? !!v : v === expected;
    checks.push({ name, value: v, ok });
  } catch (e) {
    checks.push({ name, value: String(e.message).slice(0, 200), ok: false });
  }
}

await check("drawer element exists", "!!document.getElementById('discoveryDrawer')");
await check("5 sub-tab buttons", "document.querySelectorAll('#discoverySubtabs .discovery-subtab').length", 5);
await check("5 sub-tab panels", "document.querySelectorAll('.discovery-subtab-panel').length", 5);
await check("settings-panel-discovery removed", "!document.getElementById('settings-panel-discovery')");
await check("settings-panel-profile removed", "!document.getElementById('settings-panel-profile')");
await check("settings-tab-profile removed", "!document.getElementById('settings-tab-profile')");
await check("5 settings tabs remain", "document.querySelectorAll('.settings-tablist__btn').length", 5);
await check("materials modal exists", "!!document.getElementById('materialsModal')");

// Open drawer programmatically
await check(
  "openDiscoveryDrawer is a function",
  "typeof window.openDiscoveryDrawer === 'function' || typeof openDiscoveryDrawer === 'function'",
);
await evalExpr(
  "(function(){var fn = window.openDiscoveryDrawer || (typeof openDiscoveryDrawer==='function' ? openDiscoveryDrawer : null); if(fn) fn({ source: 'smoke' }); return !!fn;})()",
);
await wait(700);
await check(
  "drawer shown after open",
  "(()=>{const d=document.getElementById('discoveryDrawer'); if(!d) return false; const cs=getComputedStyle(d); return cs.display !== 'none' && !d.hasAttribute('hidden');})()",
);
await check(
  "dd-tab-automation present in DOM after open",
  "!!document.getElementById('dd-tab-automation')",
);

// Sub-tab switching → Automation
await evalExpr(
  "(()=>{const b=document.getElementById('dd-tab-automation'); if(b) b.click();})()",
);
await wait(200);
await check("Automation panel visible after click", "(()=>{const p=document.getElementById('dd-panel-automation'); return !!p && !p.hidden;})()");
await check("Search panel hidden after Automation click", "(()=>{const p=document.getElementById('dd-panel-search'); return !!p && p.hidden;})()");

// Sub-tab switching → Connection
await evalExpr(
  "(()=>{const b=document.getElementById('dd-tab-connection'); if(b) b.click();})()",
);
await wait(200);
await check("Connection panel visible after click", "(()=>{const p=document.getElementById('dd-panel-connection'); return !!p && !p.hidden;})()");
await check("Automation panel hidden after Connection click", "(()=>{const p=document.getElementById('dd-panel-automation'); return !!p && p.hidden;})()");

// Core moved fields reachable
await check("webhook URL field reachable", "!!document.getElementById('settingsDiscoveryWebhookUrl')");
await check("schedule local enable reachable", "!!document.getElementById('settingsProfileScheduleLocalEnable')");
await check("Apps Script details reachable", "!!document.getElementById('settingsAppsScriptDetails')");

// Close via the documented contract: any data-action="close-discovery-drawer"
await evalExpr(
  "(()=>{const b=document.querySelector('[data-action=\"close-discovery-drawer\"]'); if(b) b.click(); else if (typeof closeDiscoveryDrawer === 'function') closeDiscoveryDrawer();})()",
);
await wait(300);
await check(
  "drawer hidden after close",
  "(()=>{const d=document.getElementById('discoveryDrawer'); if(!d) return true; const cs=getComputedStyle(d); return cs.display === 'none' || d.hasAttribute('hidden');})()",
);

// Sanity check: ensure no init-time JS errors broke the page
await check(
  "page title rendered",
  "document.title.length > 0",
);

let pass = 0, fail = 0;
for (const c of checks) {
  const label = c.ok ? "PASS" : "FAIL";
  console.log(`[${label}] ${c.name} → ${JSON.stringify(c.value)}`);
  if (c.ok) pass++; else fail++;
}
console.log(`\n[smoke] ${pass} pass, ${fail} fail`);
if (errors.length) {
  console.log("\n[smoke] JS exceptions during run:");
  for (const e of errors.slice(0, 10)) console.log("  -", String(e).slice(0, 300));
}

ws.close();
chrome.kill();
process.exit(fail || errors.length ? 1 : 0);
