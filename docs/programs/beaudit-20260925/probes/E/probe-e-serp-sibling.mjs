// DOSSIER-01 server half: the Google Jobs fallback accepts a title+company-only match and returns
// a DIFFERENT posting (other location, other job id) as the scrape result. Hermetic: stubbed fetch.
//   env -i PATH="$PATH" HOME="$PWD/.lane-evidence/home" node .lane-evidence/probes/probe-e-serp-sibling.mjs
import { scrapeJobPosting } from "../../server/shared/job-scraper-core.mjs";
const calls = [];
const fetchImpl = async (url) => {
  const u = String(url);
  calls.push(u.replace(/api_key=[^&]+/, "api_key=[probe]"));
  if (u.startsWith("https://serpapi.com/")) {
    return new Response(JSON.stringify({ jobs_results: [{
      title: "Senior Software Engineer", company_name: "Acme", location: "Berlin, Germany",
      job_id: "SIBLING-999", description: "Sibling posting in Berlin. ".repeat(40),
      apply_options: [{ link: "https://careers.acme.example/jobs/SIBLING-999" }],
    }] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  // The requested posting page: blocked/thin HTML (as many boards serve to bots).
  return new Response("<html><head><title>Acme</title></head><body>Enable JavaScript</body></html>",
    { status: 200, headers: { "content-type": "text/html" } });
};
const requested = "https://jobs.acme.example/posting/AUSTIN-123";
const r = await scrapeJobPosting(requested, {
  title: "Senior Software Engineer", company: "Acme", fetchImpl, serpApiKey: "probe-serp",
});
console.log(JSON.stringify({
  requested, returnedUrl: r.url, matchedUrl: r.scraping?.matchedUrl, location: r.location,
  method: r.method, lineage: r.scraping?.lineage, warnings: r.warnings,
  descriptionHead: r.description.slice(0, 60), matchKindField: "matchKind" in r || "exactMatch" in r,
}, null, 2));
console.log("fetches:", calls);
