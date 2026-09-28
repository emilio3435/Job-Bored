// Probe: which known job-board hosts does the write-path policy classify as extractable (i.e. writable as canonical URL)?
// Run: node --experimental-strip-types .lane-evidence/probes/C-jobboard-hint-only.mjs
import { classifyCareerSurfaceSourcePolicy } from "../../integrations/browser-use-discovery/src/discovery/career-surface-resolver.ts";
import { classifyIngestUrl } from "../../integrations/browser-use-discovery/src/sources/ingest-url-router.ts";
const hosts = ["www.linkedin.com","lnkd.in","www.indeed.com","www.glassdoor.com","www.ziprecruiter.com","www.monster.com","www.careerbuilder.com","www.simplyhired.com","wellfound.com","angel.co","builtin.com","www.builtinnyc.com","otta.com","www.welcometothejungle.com","www.workingnomads.com","remoteok.com","www.dice.com","www.jobs2careers.com","www.google.com","weworkremotely.com","remotive.com","jobs.github.com","www.themuse.com","hired.com","www.adzuna.com","www.talent.com","jooble.org","www.flexjobs.com","clever.com","www.greenhouse-careers-scam.com"];
for (const h of hosts) {
  const url = `https://${h}/jobs/view/12345`;
  const ing = classifyIngestUrl(url);
  console.log(h.padEnd(34), "writePolicy=" + classifyCareerSurfaceSourcePolicy(url).padEnd(12), "ingest=" + ing.kind + (ing.provider ? `(${ing.provider})` : ""));
}
