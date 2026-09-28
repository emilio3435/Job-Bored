// Trust boundary (cross-lane C/SEC-04): expired cleanup fetches any Link in the
// Sheet, including loopback, with redirect:"follow" and no SSRF guard.
import http from "node:http";
import { checkJobPostingUrl } from "../../integrations/browser-use-discovery/src/cleanup/expired-job-cleanup.ts";
let hits = [];
const srv = http.createServer((req, res) => { hits.push(req.url); res.end("internal admin page: apply now"); });
await new Promise((r) => srv.listen(18140, "127.0.0.1", r));
const c = await checkJobPostingUrl("http://127.0.0.1:18140/internal-only", { timeoutMs: 2000 });
srv.close();
console.log("loopback hits:", JSON.stringify(hits), "classification:", c.status, c.source);
console.log(hits.length ? "DEFECT CONFIRMED: cleanup fetched a loopback URL taken from the Sheet" : "blocked");
