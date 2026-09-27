import type { AtsSourceId } from "../contracts.ts";

export type AtsHostSignature = {
  provider: AtsSourceId;
  match: RegExp;
};

export type AggregatorHostSignature = {
  provider: string;
  match: RegExp;
};

export const ATS_HOST_SIGNATURES: AtsHostSignature[] = [
  { match: /(^|\.)greenhouse\.io$/i, provider: "greenhouse" },
  { match: /(^|\.)lever\.co$/i, provider: "lever" },
  { match: /(^|\.)ashbyhq\.com$/i, provider: "ashby" },
  { match: /(^|\.)smartrecruiters\.com$/i, provider: "smartrecruiters" },
  { match: /(^|\.)myworkdayjobs\.com$/i, provider: "workday" },
  { match: /(^|\.)workdayjobs\.com$/i, provider: "workday" },
  { match: /(^|\.)icims\.com$/i, provider: "icims" },
  { match: /(^|\.)jobvite\.com$/i, provider: "jobvite" },
  { match: /(^|\.)taleo\.net$/i, provider: "taleo" },
  { match: /(^|\.)successfactors\.[a-z]+(\.[a-z]+)?$/i, provider: "successfactors" },
  { match: /(^|\.)workable\.com$/i, provider: "workable" },
  { match: /(^|\.)applytojob\.com$/i, provider: "workable" },
  { match: /(^|\.)breezy\.hr$/i, provider: "breezy" },
  { match: /(^|\.)recruitee\.com$/i, provider: "recruitee" },
  { match: /(^|\.)teamtailor\.com$/i, provider: "teamtailor" },
  { match: /(^|\.)personio\.(com|de)$/i, provider: "personio" },
];

export const AGGREGATOR_HOST_SIGNATURES: AggregatorHostSignature[] = [
  { provider: "linkedin", match: /(^|\.)linkedin\.com$/i },
  { provider: "linkedin", match: /^lnkd\.in$/i },
  { provider: "indeed", match: /(^|\.)indeed\.com$/i },
  { provider: "glassdoor", match: /(^|\.)glassdoor\.com$/i },
  { provider: "ziprecruiter", match: /(^|\.)ziprecruiter\.com$/i },
  { provider: "monster", match: /(^|\.)monster\.com$/i },
  { provider: "careerbuilder", match: /(^|\.)careerbuilder\.com$/i },
  { provider: "simplyhired", match: /(^|\.)simplyhired\.com$/i },
  { provider: "wellfound", match: /(^|\.)wellfound\.com$/i },
  { provider: "angel", match: /(^|\.)angel\.co$/i },
  { provider: "builtin", match: /(^|\.)builtin(?:\w+)?\.(?:com|org)$/i },
  { provider: "otta", match: /(^|\.)otta\.com$/i },
  { provider: "welcome_to_the_jungle", match: /(^|\.)welcometothejungle\.com$/i },
  { provider: "workingnomads", match: /(^|\.)workingnomads\.com$/i },
  { provider: "remoteok", match: /(^|\.)remoteok\.com$/i },
  { provider: "dice", match: /(^|\.)dice\.com$/i },
  { provider: "jobs2careers", match: /(^|\.)jobs2careers\.com$/i },
  { provider: "google", match: /(^|\.)google\.com$/i },
  // Union with the former write-policy board list (C7): one shared table
  // feeds the ingest router, SerpApi ranking, and the write policy, so a
  // board URL can never be written as the canonical Link.
  { provider: "simplyhired_uk", match: /(^|\.)simplyhired\.co\.uk$/i },
  { provider: "remote_co", match: /(^|\.)remote\.co$/i },
  { provider: "weworkremotely", match: /(^|\.)weworkremotely\.com$/i },
  { provider: "remotive", match: /(^|\.)remotive\.io$/i },
  { provider: "dynamitejobs", match: /(^|\.)dynamitejobs\.com$/i },
  { provider: "jobspresso", match: /(^|\.)jobspresso\.co$/i },
  { provider: "jobgether", match: /(^|\.)jobgether\.com$/i },
  { provider: "himalayas", match: /(^|\.)himalayas\.app$/i },
  { provider: "flexjobs", match: /(^|\.)flexjobs\.com$/i },
  { provider: "powertofly", match: /(^|\.)powertofly\.com$/i },
  { provider: "jooble", match: /(^|\.)jooble\.org$/i },
  { provider: "talent", match: /(^|\.)talent\.com$/i },
  { provider: "snagajob", match: /(^|\.)snagajob\.com$/i },
  { provider: "jobtoday", match: /(^|\.)jobtoday\.com$/i },
  { provider: "jobisjob", match: /(^|\.)jobisjob\.com$/i },
  { provider: "careerjet", match: /(^|\.)careerjet\.com$/i },
  { provider: "jobrapido", match: /(^|\.)jobrapido\.com$/i },
  { provider: "adzuna", match: /(^|\.)adzuna\.com$/i },
  { provider: "jobtarget", match: /(^|\.)jobtarget\.com$/i },
  { provider: "hireology", match: /(^|\.)hireology\.com$/i },
  { provider: "jobot", match: /(^|\.)jobot\.com$/i },
  { provider: "jobleads", match: /(^|\.)jobleads\.com$/i },
  { provider: "lensa", match: /(^|\.)lensa\.com$/i },
  { provider: "workfromhome_ng", match: /(^|\.)workfromhome\.ng$/i },
  { provider: "instituteofdata", match: /(^|\.)instituteofdata\.jobs$/i },
];
