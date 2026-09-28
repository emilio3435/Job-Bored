// Probe: worker browser session fetch path has no SSRF guard (raw fetch, follows redirects).
// Run: node --experimental-strip-types .lane-evidence/probes/C-ssrf-session.mjs
import http from "node:http";
import { createBrowserUseSessionManager } from "../../integrations/browser-use-discovery/src/browser/session.ts";
import { safeFetch } from "../../integrations/browser-use-discovery/src/net/safe-fetch.ts";
import { classifyCareerSurfaceSourcePolicy } from "../../integrations/browser-use-discovery/src/discovery/career-surface-resolver.ts";

const PORT = 18130;
const server = http.createServer((req, res) => {
  if (req.url === "/redirect") { res.writeHead(302, { location: `http://127.0.0.1:${PORT}/secret` }); return res.end(); }
  res.writeHead(200, { "content-type": "text/plain" }); res.end("PROBE-INTERNAL-SECRET path=" + req.url);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const out = (k, v) => console.log(k.padEnd(44), JSON.stringify(v));
try {
  const direct = createBrowserUseSessionManager({ browserUseCommand: "" });
  const r1 = await direct.run({ url: `http://127.0.0.1:${PORT}/secret`, instruction: "x", timeoutMs: 2000 });
  out("session(no command) loopback ->", { mode: r1.metadata.mode, text: r1.text });
  const r2 = await direct.run({ url: `http://127.0.0.1:${PORT}/redirect`, instruction: "x", timeoutMs: 2000 });
  out("session(no command) redirect ->", { mode: r2.metadata.mode, text: r2.text });
  const failing = createBrowserUseSessionManager({ browserUseCommand: "exit 3" });
  const r3 = await failing.run({ url: `http://127.0.0.1:${PORT}/secret`, instruction: "x", timeoutMs: 2000 });
  out("session(command fails -> fetch_fallback) ->", { mode: r3.metadata.mode, text: r3.text });
  try { await safeFetch(`http://127.0.0.1:${PORT}/secret`); out("safeFetch loopback ->", "ALLOWED (bad)"); }
  catch (e) { out("safeFetch loopback ->", "BLOCKED: " + e.message); }
  out("policy(http://127.0.0.1/) ->", classifyCareerSurfaceSourcePolicy("http://127.0.0.1/jobs"));
  out("policy(http://127.0.0.1.nip.io/) ->", classifyCareerSurfaceSourcePolicy("http://127.0.0.1.nip.io/jobs"));
  out("policy(http://169.254.169.254.nip.io/) ->", classifyCareerSurfaceSourcePolicy("http://169.254.169.254.nip.io/latest"));
} finally { server.close(); }
