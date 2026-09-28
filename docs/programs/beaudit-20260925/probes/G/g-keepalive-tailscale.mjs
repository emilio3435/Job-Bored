// Probe G (SETUP-05 twin): keep-alive on a Tailscale (*.ts.net) transport. fetch + spawnSync stubbed; sandbox HOME.
import { mkdirSync, writeFileSync } from "node:fs";
import { runKeepAliveCheck } from "../../scripts/discovery-keep-alive.mjs";
import { inferTransportKindFromUrl } from "../../scripts/lib/discovery-transport.mjs";
const home = new URL("../home/", import.meta.url).pathname; mkdirSync(home, { recursive: true });
const state = home + "ka-bootstrap.json";
writeFileSync(state, JSON.stringify({ localPort: 8644, publicTargetUrl: "https://mac.tail1234.ts.net/webhook" }));
const fetched = []; const spawned = [];
const r = await runKeepAliveCheck({ homeDir: home, bootstrapStatePath: state,
  fetchImpl: async (u) => { fetched.push(String(u)); return { ok: false, status: 502, json: async () => ({}) }; },
  spawnSyncImpl: (c, a) => { spawned.push([c, ...a].join(" ")); return { status: 0, stdout: "", stderr: "" }; } });
console.log("inferTransportKindFromUrl(ts.net) =", JSON.stringify(inferTransportKindFromUrl("https://mac.tail1234.ts.net")));
console.log("result:", JSON.stringify(r)); console.log("fetched:", fetched); console.log("spawned:", spawned);
