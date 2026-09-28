// Probe G: templates/cloudflare-worker/worker.js (what deploy-cloudflare-relay.mjs:34 ships) injects
// DISCOVERY_SECRET for ANY caller when FORWARD_SECRET is unset (the documented dashboard path).
// Runs the Worker's fetch() in Node against a capture server on 127.0.0.1:18176. No Cloudflare, no network.
import { createServer } from "node:http";
import worker from "../../templates/cloudflare-worker/worker.js";
const seen = [];
const srv = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)).on("end", () => {
  seen.push({ path: req.url, secret: req.headers["x-discovery-secret"] || null, body: b.slice(0, 60) });
  res.writeHead(202, { "content-type": "application/json" }); res.end('{"ok":true,"accepted":true}'); }); });
await new Promise((r) => srv.listen(18176, "127.0.0.1", r));
const env = { TARGET_URL: "http://127.0.0.1:18176/webhook", DISCOVERY_SECRET: "probe-secret", CORS_ORIGIN: "https://user.github.io" };
// An anonymous internet caller: no Origin, no Authorization, no secret. Root path and an arbitrary subpath.
for (const path of ["/", "/webhook", "/anything/else"]) {
  const res = await worker.fetch(new Request("https://jobbored-relay.example.workers.dev" + path, {
    method: "POST", headers: { "content-type": "text/plain" }, body: '{"event":"command-center.discovery","sheetId":"attacker"}' }), env, {});
  console.log(`anon POST ${path} -> relay ${res.status}`);
}
console.log("upstream saw:", JSON.stringify(seen, null, 1));
srv.close();
