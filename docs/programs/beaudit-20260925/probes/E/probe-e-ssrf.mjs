// SSRF classifier edge cases, hermetic (stubbed DNS, no network).
//   node .lane-evidence/probes/probe-e-ssrf.mjs
import { validateScrapeTarget, validateScrapeTargetWithDns } from "../../server/security-boundaries.mjs";
const literals = [
  "http://127.0.0.1/", "http://2130706433/", "http://0x7f.0.0.1/", "http://[::ffff:127.0.0.1]/",
  "http://169.254.169.254/", "http://[fd00::1]/", "http://localhost./",
  "http://[64:ff9b::7f00:1]/",      // NAT64 well-known prefix embedding 127.0.0.1
  "http://[64:ff9b::a9fe:a9fe]/",   // NAT64 embedding 169.254.169.254 (metadata)
  "http://[2002:7f00:1::]/",        // 6to4 embedding 127.0.0.1
  "http://198.18.0.1/",             // 198.18.0.0/15 benchmark (non-public)
  "http://[fec0::1]/",              // deprecated site-local
];
for (const u of literals) {
  const r = validateScrapeTarget(u);
  console.log(`${r.ok ? "ALLOWED" : "blocked"}  literal  ${u}${r.ok ? "" : "  (" + r.error + ")"}`);
}
const dnsCases = [
  ["a.example", [{ address: "64:ff9b::7f00:1", family: 6 }]],
  ["b.example", [{ address: "2002:a9fe:a9fe::1", family: 6 }]],
  ["c.example", [{ address: "10.0.0.5", family: 4 }]],
];
for (const [host, addrs] of dnsCases) {
  const r = await validateScrapeTargetWithDns(`https://${host}/job`, { lookupImpl: async () => addrs });
  console.log(`${r.ok ? "ALLOWED" : "blocked"}  dns->${addrs[0].address}  https://${host}/job`);
}
