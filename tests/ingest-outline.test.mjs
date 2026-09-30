import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildLedger } from '../server/materials-ledger-build.mjs';
import { planResume } from '../server/materials-outline.mjs';
import { scoreClaims } from '../server/materials-claim-score.mjs';
import { selectRankedClaims } from '../server/materials-select.mjs';
const company = (name, start, end, title = 'Research Lead') => ({ name, aliases: [name.toLowerCase()], start, end, roles: [{ title, start, end }], claims: [] });
const ledgerOf = (...employers) => buildLedger({ profile: null, resumeText: 'Fictional experience record.', structure: { source: 'model', employers, education: [], credentials: [], looseClaims: [] } });
const ids = (ledger) => ledger.claims.map((claim) => claim.id);
const plan = (ledger, kept = ids(ledger), earlierMax = 5) => planResume({ ledger, kept, featuredMax: 1, perFeaturedMax: 4, earlierMax });
const extract = { jdHash: 'sha256:0', role: { family: 'media', title: 'Research Lead' }, nouns: [{ term: 'research' }], outcomes: [] };

it('T-K14-01 a role-claim-only employer renders in Earlier', () => {
  const ledger = ledgerOf(company('Contoso Media', 'Sep 2017', '2026'), company('Fabrikam Labs', 'Jan 2025', 'Present'));
  const out = plan(ledger, ids(ledger).filter((id) => id.includes('fabrikam')));
  assert.ok(out.earlier.some((id) => ledger.claims.find((claim) => claim.id === id)?.employerId === 'contoso-media'));
});
it('T-K14-02 every non-retired employer contributes a claim to the candidate pool', () => {
  const employers = Array.from({ length: 22 }, (_, n) => company(`Fictional Studio ${n + 1}`, `${2000 + n}`, '2026'));
  const ledger = ledgerOf(...employers);
  const pool = scoreClaims({ extract, ledger, limit: 20 });
  assert.equal(new Set(pool.map((item) => ledger.claims.find((claim) => claim.id === item.claimId)?.employerId)).size, 22);
});
it('T-K14-03 month-year ends break same-year recency ties', () => {
  const ledger = ledgerOf(company('Contoso Media', 'Jan 2010', 'Jan 2020'), company('Fabrikam Labs', 'Jan 2010', 'Sep 2020'));
  const out = plan(ledger);
  assert.equal(out.featured[0].employerId, 'fabrikam-labs');
});
it('T-K14-04 selector omission reasons use the four-code contract', () => {
  const ledger = ledgerOf(company('Contoso Media', 'Jan 2010', 'Jan 2020'), company('Fabrikam Labs', 'Jan 2022', 'Present'), company('Northwind Trading', 'Jan 2024', 'Present'));
  const shortlist = scoreClaims({ extract, ledger, limit: 20 });
  const selection = selectRankedClaims({ extract, shortlist: shortlist.slice(0, 1), ledger });
  assert.ok(selection.omittedEmployers.length > 0);
  assert.ok(selection.omittedEmployers.every((entry) => ['page_budget', 'fit_ladder', 'low_relevance', 'user_retired'].includes(entry.reason)));
});
it('T-K14-06 top two by tenure survive outline despite one Earlier slot', () => {
  const ledger = ledgerOf(company('Contoso Media', 'Jan 2000', 'Jan 2020'), company('Fabrikam Labs', 'Jan 2001', 'Jan 2020'), company('Northwind Trading', 'Jan 2025', 'Present'));
  const recent = ids(ledger).filter((id) => id.includes('northwind'));
  const out = plan(ledger, recent, 1);
  const shown = new Set([...out.featured.map((entry) => entry.employerId), ...out.earlier.map((id) => ledger.claims.find((claim) => claim.id === id)?.employerId)]);
  assert.ok(shown.has('contoso-media'));
  assert.ok(shown.has('fabrikam-labs'));
});
it('T-K14-08 explicit foreign-section quarantine stays out of the pool and outline', () => {
  const ledger = ledgerOf(company('Contoso Media', 'Jan 2022', 'Present'));
  ledger.claims.push({ id: 'resume-quarantined', employerId: 'contoso-media', kind: 'achievement', text: 'A claim cited inside another employer section.', attribution: 'inferred', quarantined: true, verified: true });
  const pool = scoreClaims({ extract, ledger, limit: 20 });
  assert.ok(!pool.some((item) => item.claimId === 'resume-quarantined'));
  const out = plan(ledger, ['resume-quarantined']);
  assert.ok(![...out.featured.flatMap((entry) => entry.claimIds), ...out.earlier].includes('resume-quarantined'));
});
