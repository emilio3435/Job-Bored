import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { buildLedger, ensureLedger, LEDGER_BUILDER_VERSION } from '../server/materials-ledger-build.mjs';
import { readLedger, validateLedger, writeLedgerAtomic } from '../server/materials-ledger.mjs';
const home = mkdtempSync(join(tmpdir(), 'jb-ingest-ledger-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.JOBBORED_PROFILE_PATH = join(home, '.jobbored', 'profile.json');
const source = readFileSync(new URL('./fixtures/ingest-corpus/C03/source.txt', import.meta.url), 'utf8');
const reply = JSON.parse(readFileSync(new URL('./fixtures/ingest-corpus/C03/stage-replies/read-run2-shape.json', import.meta.url), 'utf8'));
const pin = { provider: 'gemini', model: 'fictional', resolvedModel: 'fictional' };
const read = (text = source, options = {}) => ensureLedger({ profile: null, resumeText: text, pin, callStage: async () => reply, ...options });
const resultPath = join(home, '.jobbored', 'ingest-result.json');
const employer = (name, title = 'Research Lead', start = 'Jan 2022', end = 'Present') => ({ name, aliases: [name.toLowerCase()], start, end, roles: [{ title, start, end }], claims: [] });
const structure = (...names) => ({ source: 'model', employers: names.map((name) => employer(name)), education: [], credentials: [], looseClaims: [] });

it('T-K8-02 rejected claims reach the persisted result', async () => {
  const out = await read();
  assert.ok(out.ingest.rejected.length > 0);
  assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')).rejected, out.ingest.rejected);
});
it('T-K8-03 claim-level review leaves a read ready and persists its status', async () => {
  const out = await read();
  assert.equal(out.ingest.status, 'ready');
  assert.equal(JSON.parse(readFileSync(resultPath, 'utf8')).status, 'ready');
});
it('T-K8-04 new identity and ingest pointer fields pass the ledger schema', async () => {
  const out = await read();
  assert.equal(out.ingestSchema, 'ingest/1');
  assert.equal(out.structureKind, 'model');
  assert.equal(out.ingest.resultPath, resultPath);
  assert.equal(validateLedger(out).ok, true);
  assert.equal((await readLedger()).ok, true);
});
it('T-K8-05 no-model first read persists needs_model and unread employers without a usable ledger', async () => {
  const fresh = `${source}\nA fresh fictional source.`;
  const out = await ensureLedger({ profile: { strengths: [{ name: 'Planning', evidence: 'Designed a planning process.' }] }, resumeText: fresh });
  const persisted = JSON.parse(readFileSync(resultPath, 'utf8'));
  assert.equal(out.ingest.status, 'needs_model');
  assert.equal(persisted.status, 'needs_model');
  assert.ok(persisted.unread.length > 0);
  assert.notEqual(out.note, 'profile:only');
});
it('T-K10-02 a rules ledger is stale even at matching hashes', async () => {
  const prior = buildLedger({ profile: null, resumeText: source, structure: structure('Contoso Media'), note: 'structure:rules' });
  prior.builderVersion = 10;
  await writeLedgerAtomic(prior);
  const out = await ensureLedger({ profile: null, resumeText: source });
  assert.notEqual(out.ingest.status, 'ready');
});
it('T-K10-03 builder 10 rebuilds with a model', async () => {
  const prior = buildLedger({ profile: null, resumeText: source, structure: structure('Contoso Media') });
  prior.builderVersion = 10;
  await writeLedgerAtomic(prior);
  const out = await read();
  assert.equal(LEDGER_BUILDER_VERSION, 11);
  assert.equal(out.builderVersion, 11);
});
it('T-K10-04 failed read over stale rules never reports ready', async () => {
  const prior = buildLedger({ profile: null, resumeText: source, structure: structure('Contoso Media'), note: 'structure:rules' });
  prior.builderVersion = 10;
  await writeLedgerAtomic(prior);
  const out = await read(source, { callStage: async () => { throw new Error('fictional provider failure'); } });
  assert.notEqual(out.ingest.status, 'ready');
});
it('T-K10-05 the rules fixture is never served to an outline', async () => {
  const prior = buildLedger({ profile: null, resumeText: source, structure: structure('Contoso Media'), note: 'structure:rules' });
  prior.builderVersion = 10;
  await writeLedgerAtomic(prior);
  const out = await read();
  assert.equal(out.ingest.status, 'ready');
  assert.equal(out.note, 'structure:model');
});
it('T-K10-07 a stored non-ready result is read again', async () => {
  await ensureLedger({ profile: null, resumeText: source });
  let calls = 0;
  const out = await read(source, { callStage: async () => { calls++; return reply; } });
  assert.ok(calls > 0);
  assert.equal(out.ingest.status, 'ready');
});
it('T-K11-01 profile save leaves the stored structure byte-identical', async () => {
  const first = await read();
  const bytes = JSON.stringify(first.resumeStructure);
  const next = await read(source, { profile: { experiences: [{ company: 'Contoso Media', title: 'Wrong Title', provenance: 'derived' }], strengths: [{ name: 'Planning', evidence: 'Coordinated local account planning.' }] }, callStage: async () => { throw new Error('profile save called model'); } });
  assert.equal(JSON.stringify(next.resumeStructure), bytes);
});
it('T-K11-02 grounded resume roles and dates outrank derived profile experience', async () => {
  const out = await read(source, { profile: { experiences: [{ company: 'Contoso Media', title: 'Wrong Title', start: '2025', end: 'Present', provenance: 'derived' }] } });
  const item = out.employers.find((entry) => entry.name.includes('Contoso'));
  assert.equal(item.roles[0].title, 'Digital Sales Manager');
  assert.equal(item.start, '2017-03');
});
it('T-K11-03 profile save makes zero structure model calls', async () => {
  await read();
  let calls = 0;
  await read(source, { profile: { strengths: [{ name: 'Planning', evidence: 'Revised a fictional planning process.' }] }, callStage: async () => { calls++; return reply; } });
  assert.equal(calls, 0);
});
it('T-K13-01 each grounded role gets a field-built role claim', async () => {
  const out = await read();
  const contoso = out.employers.find((entry) => entry.name.includes('Contoso'));
  const claims = out.claims.filter((claim) => claim.kind === 'role' && claim.employerId === contoso.id);
  assert.equal(claims.length, contoso.roles.length);
  assert.ok(claims.some((claim) => claim.text.includes('Digital Sales Manager') && claim.text.includes('Contoso')));
});
it('T-K13-02 descriptor and umbrella tail reach a role claim', async () => {
  const out = await read();
  assert.ok(out.claims.some((claim) => claim.kind === 'role' && claim.text.includes('three progressive roles')));
  assert.ok(out.claims.some((claim) => claim.kind === 'role' && claim.text.includes('Springfield')));
});
it('T-K13-03 bulletless C03 umbrella employer has a renderable role claim', async () => {
  const out = await read();
  const item = out.employers.find((entry) => entry.name.includes('Contoso'));
  assert.ok(out.claims.some((claim) => claim.employerId === item.id && claim.kind === 'role'));
});
it('T-K13-04 same title and dates at two employers retain both role claims', () => {
  const out = buildLedger({ profile: null, resumeText: 'fictional source', structure: structure('Contoso Media', 'Fabrikam Labs') });
  assert.equal(out.claims.filter((claim) => claim.kind === 'role').length, 2);
});
it('T-INV4-03 equal-count same-hash alias swap does not publish', async () => {
  const first = await read();
  const saved = (await readLedger()).ledger;
  const swapped = structuredClone(reply);
  swapped.employers[0].name = 'Invented Media';
  const out = await read(source, { callStage: async () => swapped });
  assert.notEqual(out.ingest.status, 'ready');
  assert.deepEqual((await readLedger()).ledger, saved);
  assert.ok(first.employers.length > 0);
});
it('T-INV4-08 guard: same-hash fewer employers and resume claims still cannot publish', async () => {
  await read();
  const saved = (await readLedger()).ledger;
  const poorer = structuredClone(reply);
  poorer.employers.pop();
  const out = await read(source, { callStage: async () => poorer });
  assert.notEqual(out.ingest.status, 'ready');
  assert.deepEqual((await readLedger()).ledger, saved);
});
it('T-K3-02 over-limit source refuses without slicing; under-limit arrives whole', async () => {
  const long = 'EXPERIENCE\nContoso Media\nJan 2022 — Present\n' + 'x'.repeat(70_000);
  const refused = await ensureLedger({ profile: null, resumeText: long, pin, callStage: async () => { throw new Error('must not call'); } });
  assert.equal(refused.ingest.code, 'resume_too_long');
  let seen = '';
  const short = 'EXPERIENCE\nContoso Media\nJan 2022 — Present\n' + 'x'.repeat(58_950);
  await ensureLedger({ profile: null, resumeText: short, pin, callStage: async ({ userText }) => { seen = userText; return { employers: [] }; } });
  assert.ok(seen.includes('x'.repeat(100)));
  assert.ok(seen.length >= short.length);
});
it('T-K16-05 resume_too_long has explicit user copy', async () => {
  const out = await ensureLedger({ profile: null, resumeText: 'x'.repeat(70_000), pin });
  assert.equal(out.ingest.code, 'resume_too_long');
  assert.match(out.ingest.reason, /60,000|too long/i);
});
