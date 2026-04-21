/**
 * Backward-compatible wrapper for the shared job scraper core.
 * Run standalone: node job-scraper.mjs <url>
 */
import { scrapeJobPosting } from "./shared/job-scraper-core.mjs";

export { scrapeJobPosting };

const urlArg = process.argv[2];
if (urlArg && urlArg.startsWith("http")) {
  scrapeJobPosting(urlArg)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
