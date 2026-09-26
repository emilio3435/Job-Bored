/**
 * Materials v3 — the six-row rubric (plan slice 5, mechanism §7.2).
 *
 * Deterministic scoring over extract + selection + draft + delint spans.
 * Each row scores 0–2; READY needs a total ≥ 10 with zero fails and the
 * letter inside its band. The note on each row says exactly what moved
 * it, so a REVIEW package explains itself.
 */

/**
 * @typedef {object} RubricRow
 * @property {string} id
 * @property {number} score
 * @property {number} max
 * @property {string} note
 */

/** @param {string} text */
function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length >= 4);
}

/**
 * @param {{ statement?: unknown, bullets?: Array<{ text?: unknown }>, earlier?: Array<{ text?: unknown }>, letter?: Record<string, unknown> }} draft
 */
function draftText(draft) {
  const parts = [];
  if (typeof draft.statement === "string") parts.push(draft.statement);
  for (const b of draft.bullets || []) {
    if (b && typeof b.text === "string") parts.push(b.text);
  }
  for (const line of draft.earlier || []) {
    if (line && typeof line.text === "string") parts.push(line.text);
  }
  const letter = draft.letter && typeof draft.letter === "object" ? draft.letter : {};
  for (const text of Object.values(letter)) {
    if (typeof text === "string") parts.push(text);
  }
  return parts.join("\n");
}

/**
 * @param {object} input
 * @param {{ outcomes?: Array<{ id?: unknown }>, nouns?: Array<{ term?: unknown }> }} input.extract
 * @param {{ kept?: Array<{ claimId?: unknown, mapsTo?: unknown[] }>, omittedEmployers?: Array<{ employerId?: unknown, justified?: unknown }> }} input.selection
 * @param {{ employers?: Array<{ id?: unknown }>, claims?: Array<{ id?: unknown, employerId?: unknown, metrics?: unknown[] }>, toolInventory?: Array<{ tool?: unknown }> }} input.ledger
 * @param {{ statement?: unknown, bullets?: Array<{ claimId?: unknown, text?: unknown }>, earlier?: Array<{ text?: unknown }>, letter?: Record<string, unknown> }} input.draft
 * @param {Array<{ severity?: unknown }>} [input.delintSpans]
 */
export function scoreRubric({ extract, selection, ledger, draft, delintSpans = [] }) {
  /** @type {RubricRow[]} */
  const rows = [];
  const kept = selection.kept || [];
  const mapped = new Set(kept.flatMap((k) => (Array.isArray(k.mapsTo) ? k.mapsTo : [])));
  const text = draftText(draft);
  const words = new Set(tokens(text));

  /* 1. Outcome coverage: kept claims map to the extract's outcomes. */
  const outcomes = extract.outcomes || [];
  const covered = outcomes.filter((o) => mapped.has(o.id)).length;
  const outcomeRatio = outcomes.length ? covered / outcomes.length : 1;
  rows.push({
    id: "outcome_coverage",
    score: outcomeRatio >= 0.8 ? 2 : outcomeRatio >= 0.5 ? 1 : 0,
    max: 2,
    note: `${covered}/${outcomes.length} outcomes mapped by kept claims`,
  });

  /* 2. Noun fidelity: the draft speaks the posting's nouns. */
  const nouns = (extract.nouns || []).map((n) => String(n.term || "").toLowerCase()).filter(Boolean);
  const hitNouns = nouns.filter((term) => words.has(term)).length;
  const nounRatio = nouns.length ? hitNouns / Math.min(nouns.length, 10) : 1;
  rows.push({
    id: "noun_fidelity",
    score: nounRatio >= 0.7 ? 2 : nounRatio >= 0.4 ? 1 : 0,
    max: 2,
    note: `${hitNouns}/${nouns.length} role nouns appear in the draft`,
  });

  /* 3. Proof density: kept claims carry metrics. */
  const claimsById = new Map((ledger.claims || []).map((c) => [c && c.id, c]));
  const withProof = kept.filter((k) => {
    const claim = claimsById.get(k.claimId);
    return claim && Array.isArray(claim.metrics) && claim.metrics.length > 0;
  }).length;
  const proofRatio = kept.length ? withProof / kept.length : 0;
  rows.push({
    id: "proof_density",
    score: proofRatio >= 0.6 ? 2 : proofRatio >= 0.3 ? 1 : 0,
    max: 2,
    note: `${withProof}/${kept.length} kept claims carry metrics`,
  });

  /* 4. Transfer honesty: every tool named is ledger-evidenced. */
  const inventoried = new Set(
    (ledger.toolInventory || []).map((t) => String(t.tool || "").toLowerCase()),
  );
  /* Scan the draft for tool-shaped tokens against a small lexicon; any
   * hit outside the inventory is an invention. */
  const lexicon = [
    "kafka", "postgres", "airflow", "python", "sql", "bigquery", "snowflake",
    "dbt", "spark", "flink", "gemini", "claude", "openai", "gcp", "aws",
    "kubernetes", "docker", "terraform", "redis", "ga4", "tableau",
  ];
  const invented = lexicon.filter((tool) => words.has(tool) && ![...inventoried].some((inv) => inv.includes(tool)));
  const toolHits = lexicon.filter((tool) => words.has(tool));
  rows.push({
    id: "transfer_honesty",
    score: invented.length ? 0 : toolHits.length ? 2 : 1,
    max: 2,
    note: invented.length
      ? `invented tools: ${invented.join(", ")}`
      : toolHits.length
        ? `${toolHits.length} named tools all ledger-evidenced`
        : "no tools named",
  });

  /* 5. Omission record: non-featured employers are justified. Only
   * employers that own ledger claims can be omitted from the selection. */
  const featuredEmployers = new Set(
    kept.map((k) => claimsById.get(k.claimId)?.employerId).filter(Boolean),
  );
  const claimedEmployers = new Set(
    (ledger.claims || []).map((c) => c && c.employerId).filter(Boolean),
  );
  const omitted = selection.omittedEmployers || [];
  const unjustified = (ledger.employers || []).filter(
    (e) => e && e.id && claimedEmployers.has(e.id) && !featuredEmployers.has(e.id) && !omitted.some((o) => o.employerId === e.id && o.justified),
  );
  rows.push({
    id: "omission_record",
    score: unjustified.length ? 0 : 2,
    max: 2,
    note: unjustified.length
      ? `unjustified omissions: ${unjustified.map((e) => e.id).join(", ")}`
      : "every omission recorded with a reason",
  });

  /* 6. Delint clean: spans after the rewrite pass. */
  const fails = delintSpans.filter((s) => s.severity === "fail").length;
  rows.push({
    id: "delint_clean",
    score: fails ? 0 : delintSpans.length ? 1 : 2,
    max: 2,
    note: fails ? `${fails} failing spans remain` : delintSpans.length ? `${delintSpans.length} review spans remain` : "no spans",
  });

  return { rows, total: rows.reduce((n, row) => n + row.score, 0) };
}
