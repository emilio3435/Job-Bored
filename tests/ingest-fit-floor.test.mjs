import assert from 'node:assert/strict';
import { classifyC03Fixture } from './fixtures/ingest-classify-c03.mjs';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { ensureLedger } from '../server/materials-ledger-build.mjs';
import { scoreClaims } from '../server/materials-claim-score.mjs';
import { selectRankedClaims } from '../server/materials-select.mjs';
import * as outlineModule from '../server/materials-outline.mjs';
import { buildRenderModelFromDraft } from '../server/materials-render-model-adapter.mjs';
import { applyStep, fitDocument } from '../server/materials-fit.mjs';
import { solveFit } from '../server/materials-fit-budget.mjs';
import { renderPackage, writePackageRecords } from '../server/materials-package.mjs';
import { resolveFamily } from '../server/materials-templates.mjs';
const home = mkdtempSync(join(tmpdir(), 'jb-ingest-fit-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.JOBBORED_PROFILE_PATH = join(home, '.jobbored', 'profile.json');
const source = readFileSync(new URL('./fixtures/ingest-corpus/C03/source.txt', import.meta.url), 'utf8');
const reply = JSON.parse(readFileSync(new URL('./fixtures/ingest-corpus/C03/stage-replies/read-run2-shape.json', import.meta.url), 'utf8'));
const job = JSON.parse(readFileSync(new URL('./fixtures/ingest-corpus/C03/job-media-tech.json', import.meta.url), 'utf8'));
async function flow() {
  const ledger = await ensureLedger({ profile: null, resumeText: source, pin: { provider: 'gemini', model: 'fictional' }, callStage: async (request) => request.stage === 'resume.classify' ? classifyC03Fixture(request) : reply });
  const shortlist = scoreClaims({ extract: job.extract, ledger, limit: 20 });
  const selection = selectRankedClaims({ extract: job.extract, shortlist, ledger });
  const outline = outlineModule.buildOutline({ selection, ledger, feature: 'resume', extract: job.extract });
  const model = buildRenderModelFromDraft({ draft: { bullets: [], earlier: [] }, outline, ledger, resumeText: source, request: job, family: resolveFamily('signal') });
  return { ledger, shortlist, selection, outline, model };
}
const entries = (model) => (model.documents.resume?.sections || []).filter((section) => ['experience', 'earlier'].includes(section.kind)).flatMap((section) => section.entries || []);
const measure = async () => ({ fits: false, scrollHeight: 1400, clientHeight: 1056, lastTextBottom: 1300, limit: 1056, blockedRequests: 0 });

it('T-K14-05 C03 media-tech job retains the umbrella employer after outline, select, and fitted package', async () => {
  const { ledger, selection, outline, model } = await flow();
  assert.ok([...outline.featured.flatMap((entry) => entry.claimIds), ...outline.earlier].some((id) => ledger.claims.find((claim) => claim.id === id)?.employerId === 'contoso-media'));
  const rendered = await renderPackage({ model, feature: 'resume', ledger, selection, session: { measure } });
  assert.ok(rendered.fit.resume.applied.length > 0);
  assert.ok(entries(rendered.fit.resume.model).some((entry) => entry.employerId === 'contoso-media'));
});
it('T-K14-10 every employer-removing fit step skips tenure-floor entries in both fit modules', async () => {
  const { ledger, model } = await flow();
  const floor = outlineModule.tenureFloorIds?.(ledger) || new Set();
  assert.equal(floor.size, 2);
  const baseline = structuredClone(model);
  const earlier = baseline.documents.resume.sections.find((section) => section.kind === 'earlier');
  const experience = baseline.documents.resume.sections.find((section) => section.kind === 'experience');
  for (const id of floor) {
    const existing = entries(baseline).find((entry) => entry.employerId === id);
    if (!existing) earlier.entries.push({ employerId: id, org: id, line: 'Fictional grounded role.', tenureFloor: true });
    else existing.tenureFloor = true;
  }
  earlier.entries.push({ employerId: 'optional-studio', org: 'Optional Studio', line: 'Optional project.' });
  experience.entries.push({ employerId: 'optional-lab', org: 'Optional Lab', bullets: [] });
  for (const step of ['drop_weakest_earlier', 'drop_weakest_featured', 'drop_section:earlier']) {
    const copy = structuredClone(baseline);
    applyStep(copy, step, []);
    assert.ok([...floor].every((id) => entries(copy).some((entry) => entry.employerId === id)), step);
  }
  for (const family of ['signal', 'dossier']) {
    const copy = structuredClone(baseline);
    copy.template.family = family;
    const fitted = await fitDocument(copy, 'resume', { measure });
    assert.ok([...floor].every((id) => entries(fitted.model).some((entry) => entry.employerId === id)), family);
    assert.equal(fitted.overflow, true);
  }
  const budget = solveFit({ pageBudget: 1, statement: 'x'.repeat(4000), featured: [{ employerId: 'floor-a', rank: 1, tenureFloor: true, bullets: [] }, { employerId: 'optional', rank: 2, bullets: [] }], earlier: [{ employerId: 'floor-b', tenureFloor: true, description: 'Fictional long description.' }, { employerId: 'optional', description: 'Optional.' }], tokens: [] });
  assert.ok(budget.applied.includes('drop_weakest_earlier'));
  assert.ok(budget.applied.includes('drop_weakest_featured'));
  assert.ok(budget.plan.featured.some((entry) => entry.employerId === 'floor-a'));
  assert.ok(budget.plan.earlier.some((entry) => entry.employerId === 'floor-b'));
  assert.equal(budget.plan.earlier.find((entry) => entry.employerId === 'floor-b').description, undefined);
  assert.equal(budget.fits, false);
});
it('T-K14-11 selector never lists a tenure-floor employer as omitted', async () => {
  const { ledger, shortlist } = await flow();
  const floor = outlineModule.tenureFloorIds?.(ledger) || new Set();
  assert.equal(floor.size, 2);
  const selection = selectRankedClaims({ extract: job.extract, shortlist: shortlist.filter((item) => !floor.has(ledger.claims.find((claim) => claim.id === item.claimId)?.employerId)).slice(0, 1), ledger });
  assert.ok([...floor].every((id) => !selection.omittedEmployers.some((entry) => entry.employerId === id)));
});
it('T-K14-12 package omission list reflects fitted employer loss with fit_ladder', async () => {
  const { ledger, selection, model } = await flow();
  const rendered = await renderPackage({ model, feature: 'resume', ledger, selection, session: { measure } });
  const omitted = rendered.omittedEmployers || [];
  assert.ok(omitted.every((entry) => ['page_budget', 'fit_ladder', 'low_relevance', 'user_retired'].includes(entry.reason)));
  const before = new Set(entries(model).map((entry) => entry.employerId));
  const after = new Set(entries(rendered.fit.resume.model).map((entry) => entry.employerId));
  for (const id of before) if (!after.has(id)) assert.equal(omitted.find((entry) => entry.employerId === id)?.reason, 'fit_ladder');
  const dir = mkdtempSync(join(tmpdir(), 'jb-ingest-manifest-'));
  const now = '2026-09-29T00:00:00.000Z';
  const { manifest } = await writePackageRecords({ dir, rendered, model, snapshot: false,
    manifestExtra: { omittedEmployers: omitted },
    run: { runId: 'fictional-run', slug: 'fictional-run', feature: 'resume', requestedAt: now, finishedAt: now, source: 'default', stages: [{ stage: 'save', status: 'ok', llm: false }] } });
  assert.deepEqual(manifest.omittedEmployers, omitted);
});
