// Probe: does the provider job key include the tenant/board? Two different
// employers on the same ATS with the same per-tenant job id.
import { computeListingFingerprint, dedupeFingerprintListings } from "../../integrations/browser-use-discovery/src/discovery/listing-fingerprint.ts";
const pairs = [
  ["greenhouse", "https://boards.greenhouse.io/acme/jobs/1", "https://boards.greenhouse.io/globex/jobs/1"],
  ["workday", "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Backend-Engineer_R-100", "https://globex.wd1.myworkdayjobs.com/en-US/External/job/Remote/Backend-Engineer_R-100"],
  ["smartrecruiters", "https://jobs.smartrecruiters.com/Acme/100-backend-engineer", "https://jobs.smartrecruiters.com/Globex/100-backend-engineer"],
  ["workable", "https://apply.workable.com/acme/j/ABC123/", "https://apply.workable.com/globex/j/ABC123/"],
];
for (const [sourceId, a, b] of pairs) {
  const la = { sourceId, title: "Backend Engineer", company: "Acme", location: "Remote", url: a };
  const lb = { sourceId, title: "Backend Engineer", company: "Globex", location: "Remote", url: b };
  const fa = computeListingFingerprint(la), fb = computeListingFingerprint(lb);
  const d = dedupeFingerprintListings([la, lb]);
  console.log(sourceId.padEnd(16), "keyA=", fa.providerJobKey || "-", "keyB=", fb.providerJobKey || "-", "| unique after dedupe:", d.uniqueItems.length, d.uniqueItems.length < 2 ? "COLLAPSED (distinct employers)" : "ok");
}
