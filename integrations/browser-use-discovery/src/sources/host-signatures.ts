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
  { match: /greenhouse/i, provider: "greenhouse" },
  { match: /lever(?:\.co|\b)/i, provider: "lever" },
  { match: /ashby(?:hq)?/i, provider: "ashby" },
  { match: /smartrecruiters/i, provider: "smartrecruiters" },
  { match: /workday|myworkdayjobs/i, provider: "workday" },
  { match: /icims/i, provider: "icims" },
  { match: /jobvite/i, provider: "jobvite" },
  { match: /taleo/i, provider: "taleo" },
  { match: /successfactors/i, provider: "successfactors" },
  { match: /workable/i, provider: "workable" },
  { match: /breezy/i, provider: "breezy" },
  { match: /recruitee/i, provider: "recruitee" },
  { match: /teamtailor/i, provider: "teamtailor" },
  { match: /personio/i, provider: "personio" },
];

export const AGGREGATOR_HOST_SIGNATURES: AggregatorHostSignature[] = [
  { provider: "linkedin", match: /(^|\.)linkedin\.com$/i },
  { provider: "indeed", match: /(^|\.)indeed\.com$/i },
  { provider: "glassdoor", match: /(^|\.)glassdoor\.com$/i },
  { provider: "ziprecruiter", match: /(^|\.)ziprecruiter\.com$/i },
  { provider: "monster", match: /(^|\.)monster\.com$/i },
  { provider: "careerbuilder", match: /(^|\.)careerbuilder\.com$/i },
  { provider: "simplyhired", match: /(^|\.)simplyhired\.com$/i },
  { provider: "wellfound", match: /(^|\.)wellfound\.com$/i },
  { provider: "angel", match: /(^|\.)angel\.co$/i },
  { provider: "builtin", match: /(^|\.)builtin(?:\w+)?\.com$/i },
  { provider: "dice", match: /(^|\.)dice\.com$/i },
  { provider: "jobs2careers", match: /(^|\.)jobs2careers\.com$/i },
  { provider: "google", match: /(^|\.)google\.com$/i },
];
