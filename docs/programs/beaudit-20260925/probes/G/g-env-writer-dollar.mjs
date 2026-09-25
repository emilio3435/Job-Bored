// Probe G: SEC-03 residual — upsertBrowserUseDiscoveryEnvValue uses String.replace with a string
// replacement, so `$'` / `$&` in a value expand. Writes only a temp file under .lane-evidence/.
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { upsertBrowserUseDiscoveryEnvValue } from "../../scripts/bootstrap-local-discovery.mjs";
const dir = new URL("./tmp-env/", import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const f = dir + "worker.env";
writeFileSync(f, "SERPAPI_API_KEY=old\nBROWSER_USE_DISCOVERY_WEBHOOK_SECRET=probe-secret\n");
try { upsertBrowserUseDiscoveryEnvValue("SERPAPI_API_KEY", "a\nINJECTED=1", f); } catch (e) { console.log("newline value:", e.code); }
upsertBrowserUseDiscoveryEnvValue("SERPAPI_API_KEY", "probe$'", f);
console.log("after value \"probe$'\":\n" + readFileSync(f, "utf8"));
