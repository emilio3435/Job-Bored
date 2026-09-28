// Probe G (SETUP-04 / P2-WRITESCOPE): what the wizard's pre-render autodetect sends when the worker is down.
// Loads discovery-autodetect.js into a stub window; fetch is recorded, nothing leaves the process.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const calls = [];
const window = { location: { hostname: "localhost", protocol: "http:", port: "8080" } };
const fetch = async (url, init = {}) => {
  calls.push({ url, method: init.method || "GET", body: init.body || "" });
  const body = String(url).includes("discovery-state")
    ? { ok: true, worker: { up: false, port: 8644 }, ngrok: { up: false }, relay: { reachable: false }, recommendation: "auto_recoverable", recoverableHint: "worker_down" }
    : { ok: true, phases: [] };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};
const ctx = vm.createContext({ window, fetch, AbortController, setTimeout, clearTimeout, console, Date, JSON, Promise });
vm.runInContext(readFileSync(new URL("../../discovery-autodetect.js", import.meta.url), "utf8"), ctx);
const verdict = await window.JobBoredDiscoveryAutodetect.recoverIfPossible(); // exactly as discovery-wizard-ui.js:2729 calls it
console.log(JSON.stringify(calls, null, 1));
console.log("full-boot URL carries skip_tunnel?", calls.some((c) => /full-boot.*skip_tunnel=1/.test(c.url)));
console.log("verdict:", JSON.stringify(verdict).slice(0, 160));
