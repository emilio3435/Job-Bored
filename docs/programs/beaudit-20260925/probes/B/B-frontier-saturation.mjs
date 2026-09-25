// Probe: frontier scorer saturates the 1-10 fit scale (PIPE-03) and the
// 18-slot exploit budget then drops leads alphabetically, not by fit.
import {
  leadToFrontierCandidate,
  selectExploitTargets,
  DEFAULT_EXPLORATION_BUDGET,
} from "../../integrations/browser-use-discovery/src/run/frontier-scorer.ts";

const mk = (company, fitScore) => ({
  sourceId: "greenhouse", sourceLabel: "Greenhouse", title: "Engineer",
  company, location: "Remote", url: `https://boards.greenhouse.io/${company}/jobs/1`,
  compensationText: "", fitScore, matchScore: null, favorite: false, dismissedAt: null,
  priority: "—", tags: [], fitAssessment: "", contact: "", status: "New",
  appliedDate: "", notes: "", followUpDate: "", talkingPoints: "", logoUrl: "",
  approvalStatus: "", discoveredAt: "2026-09-25T00:00:00Z",
  metadata: { runId: "r", variationKey: "", sourceQuery: "", sourceLane: "ats_provider", companyKey: company },
});
// 26 ATS leads: company "a..." has fit 1 (worst), company "z..." has fit 10 (best)
const letters = "abcdefghijklmnopqrstuvwxyz".split("");
const leads = letters.map((l, i) => mk(`${l}-co`, Math.max(1, Math.round((i / 25) * 9) + 1)));
const cands = leads.map((l) => leadToFrontierCandidate(l, "ats_provider"));
console.log("composite by fit:", [...new Set(cands.map((c, i) => `fit${leads[i].fitScore}=${c.compositeScore}`))].join(" "));
console.log("roleFit range:", Math.min(...cands.map((c) => c.scores.roleFit)), "-", Math.max(...cands.map((c) => c.scores.roleFit)));
const res = selectExploitTargets(cands, DEFAULT_EXPLORATION_BUDGET, {});
const picked = res.selectedTargets.map((t) => t.companyKey + ":" + leads.find((l) => l.url === t.url).fitScore);
const dropped = res.rejectedCandidates.map((t) => t.companyKey + ":" + leads.find((l) => l.url === t.url).fitScore);
console.log("budget maxExploitSurfaces:", DEFAULT_EXPLORATION_BUDGET.maxExploitSurfaces);
console.log("selected (company:fit):", picked.join(" "));
console.log("dropped  (company:fit):", dropped.join(" "));
const nullFit = leadToFrontierCandidate(mk("n-co", null), "ats_provider");
console.log("null fitScore -> roleFit", nullFit.scores.roleFit, "composite", nullFit.compositeScore);
