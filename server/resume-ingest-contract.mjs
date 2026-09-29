/** @typedef {{ lines: [number, number], text?: string }} LinePointer */
/** @typedef {{ name: string, lines: [number, number], roles: Array<{title:string,start?:string|null,end?:string|null,lines:[number,number]}>, claims: Array<{text:string,lines:[number,number]}> }} ReadEmployer */
/** @typedef {{ employers: ReadEmployer[], education?: LinePointer[], credentials?: LinePointer[], projects?: LinePointer[], volunteer?: LinePointer[], nonJob?: Array<{lines:[number,number],reason:string}> }} ReadReply */
/** @typedef {{ unaccounted:object[], setAside:object[], residual:object[], coverage:{linesAttributed:number,linesNonBlank:number,anchorsAccounted:number,anchorsTotal:number,datedAnchorsAccounted:number,datedAnchorsTotal:number}, reconciliation:{ok:boolean,failures:string[]} }} ReconcileOutput */
/** @typedef {{ schema:"ingest-result/1", status:"ready"|"ready_with_review"|"partial"|"needs_model"|"failed", sourceMode:"text"|"native+text"|"ocr+text", originalSha256:string,textSha256:string,model:{provider:string,id:string},chunks:number,anchors:number, employers:object[],structure:object, unread:object[], setAside:object[], review:{claims:object[]}, rejected:object[],carried:object[],resolutions:object[],notes:object[], missingEmployers:Array<{aliasKey:string,displayName:string,lines:number[]}>, reads:number, stopReasons:string[], coverage:ReconcileOutput["coverage"], reconciliation:ReconcileOutput["reconciliation"] }} IngestResult */

/** @param {unknown} value @returns {value is Record<string, any>} */
const object = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** @param {any} value */
const pointer = (value) => Array.isArray(value) && value.length === 2 && Number.isInteger(value[0]) && Number.isInteger(value[1]) && value[0] > 0 && value[1] >= value[0];
/** @param {any} value @param {string} key */
const item = (value, key) => object(value) && typeof value[key] === "string" && pointer(value.lines);
/** @param {any} value */
const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** @param {any} value */
const coverage = (value) => object(value) && ["linesAttributed", "linesNonBlank", "anchorsAccounted", "anchorsTotal", "datedAnchorsAccounted", "datedAnchorsTotal"].every((key) => number(value[key]));
/** @param {any} raw @returns {{ok:boolean,errors:string[]}} */
export function validateReadReply(raw) {
  const errors = [];
  if (!object(raw) || !Array.isArray(raw.employers)) errors.push("employers");
  else for (const employer of raw.employers) {
    if (!item(employer, "name") || !Array.isArray(employer.roles) || !Array.isArray(employer.claims)) errors.push("employer");
    else {
      if (/** @type {any[]} */ (employer.roles).some((role) => !item(role, "title"))) errors.push("role");
      if (/** @type {any[]} */ (employer.claims).some((claim) => !item(claim, "text"))) errors.push("claim");
    }
  }
  return { ok: !errors.length, errors };
}

/** @param {any} raw @returns {{ok:boolean,errors:string[]}} */
export function validateReconciliation(raw) {
  const errors = [];
  if (!object(raw) || !Array.isArray(raw.unaccounted) || !Array.isArray(raw.setAside) || !Array.isArray(raw.residual)) errors.push("items");
  if (!coverage(raw?.coverage)) errors.push("coverage");
  if (!object(raw?.reconciliation) || typeof raw.reconciliation.ok !== "boolean" || !Array.isArray(raw.reconciliation.failures)) errors.push("reconciliation");
  return { ok: !errors.length, errors };
}

/** @param {any} raw @returns {{ok:boolean,errors:string[]}} */
export function validateIngestResult(raw) {
  const errors = [];
  if (!object(raw) || raw.schema !== "ingest-result/1") errors.push("schema");
  if (!["ready", "ready_with_review", "partial", "needs_model", "failed"].includes(raw?.status)) errors.push("status");
  if (!Array.isArray(raw?.employers) || !Array.isArray(raw?.unread) || !Array.isArray(raw?.setAside) || !Array.isArray(raw?.rejected)) errors.push("items");
  if (!object(raw?.review) || !Array.isArray(raw.review.claims)) errors.push("review.claims");
  if (!Array.isArray(raw?.missingEmployers) || /** @type {any[]} */ (raw.missingEmployers).some((entry) => !object(entry) || typeof entry.aliasKey !== "string" || typeof entry.displayName !== "string" || !pointer(entry.lines))) errors.push("missingEmployers");
  const missing = new Set(/** @type {any[]} */ (raw?.missingEmployers || []).map((entry) => entry.aliasKey));
  if (/** @type {any[]} */ (raw?.unread || []).some((entry) => entry.kind === "employer_header" && entry.aliasKey && !missing.has(entry.aliasKey))) errors.push("missingEmployers_incomplete");
  if (!Number.isInteger(raw?.reads) || raw.reads < 0 || !Array.isArray(raw?.stopReasons)) errors.push("reads");
  if (!validateReconciliation({ unaccounted: [], setAside: [], residual: [], coverage: raw?.coverage, reconciliation: raw?.reconciliation }).ok) errors.push("reconciliation");
  return { ok: !errors.length, errors };
}
