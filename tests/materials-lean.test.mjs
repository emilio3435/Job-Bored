import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { resumeText, jdText, ledger, resumeRead, response, provider, pin, fakeSession } from './fixtures/lean/fixture.mjs';
import * as adapter from '../server/materials-render-model-adapter.mjs';
import { pipelineCacheKey } from '../server/materials-cache.mjs';
import { runJsonStage } from '../server/materials-writer.mjs';
import { runPipeline } from '../server/materials-pipeline.mjs';
import { normalizeRequestBody } from '../server/materials-request.mjs';
import { deriveNodes, applyOps } from '../server/materials-nodes.mjs';
import { renderDocument, runsToText } from '../server/materials-render.mjs';
import { resolveFamily } from '../server/materials-templates.mjs';
import { regeneratePackage } from '../server/materials-regenerate.mjs';
const sandbox = await mkdtemp(join(tmpdir(), 'jb-lean-tests-'));
process.env.JOBBORED_PROFILE_PATH = join(sandbox, 'profile.json');
after(async () => rm(sandbox, { recursive: true, force: true }));
const lean = await import('../server/materials-lean.mjs').catch(() => ({}));
function api(name) { assert.equal(typeof lean[name], 'function', `missing lean capability: ${name}`); return lean[name]; }
function input(extra = {}) { return { ledger: structuredClone(ledger), resumeText, jdText, resumeRead, feature: 'both', ...extra }; }
function check(value = response(), extra = {}) { return api('checkLean')({ ...input(extra), value }); }
function model(value = response(), extra = {}) {
  const checked = check(value);
  assert.equal(typeof adapter.buildRenderModelFromLean, 'function', 'missing lean render adapter');
  return adapter.buildRenderModelFromLean({ ...input(), ...checked, family: resolveFamily('signal'), request: { company: 'Harbor Fleet', title: 'Operations Analyst', hiringManager: 'Casey' }, nowIso: '2026-10-03T12:00:00.000Z', ...extra });
}
async function pipeline(feature = 'both', values = [response()], extra = {}) {
  const dir = extra.dir || await mkdtemp(join(sandbox, 'run-'));
  const stub = provider(values);
  const result = await runPipeline({ ...input(), dir, runId: extra.runId || 'lean-1', payload: { slug: 'harbor-role', company: 'Harbor Fleet', title: 'Operations Analyst', feature, engine: 'lean', enrichment: { contact: 'Casey' } },
    pin, fetchImpl: stub.fetchImpl, voiceProfile: null, readMarks: async () => [], openSession: fakeSession, requirePdf: true,
    services: { resumeRead, resolveMaterialLogos: async () => ({ marks: [], targetMark: null }),
      extractJd: () => { throw new Error('lean must not call extraction model'); }, draftSlots: () => { throw new Error('lean must not call legacy writer'); }, judgeMaterials: () => { throw new Error('lean must not judge'); }, ...extra.services }, ...extra });
  return { result, dir, stub };
}
const json = async (dir, name) => JSON.parse(await readFile(dir instanceof URL ? new URL(name, dir) : join(dir, name), 'utf8'));
const words = text => text.split(/\s+/).filter(Boolean).length;

test('L1 shared grammar parses eleven number probes, including approximate ranges', () => {
  assert.equal(typeof adapter.METRIC_RE, 'object', 'export shared grammar');
  const probes = ['$10M', '$10M+', '21+', '20+', '60%', '130%', '$2.4M', '8–10', '~8–10', 'top-3', '#19'];
  assert.deepEqual(api('parseLeanNumbers')(probes.join('; ')).map(n => n.token), probes);
  const v = response(); v.roles[2].bullets[0] = { text: 'Ranked top-3 among 19 analysts in 20+.', basedOn: 'C2' };
  assert.equal(check(v).draft.bullets.find(b => b.claimId === 'claim-6').text, ledger.claims[5].text, 'years cannot round down');
});
test('L2 unit mismatch falls back; legal count rounding keeps units', () => {
  const v = response(); v.roles[0].bullets[0].text = 'Managed 20+ direct reports.';
  const c = check(v); assert.equal(c.draft.bullets[0].text, ledger.claims[0].text);
  v.roles[0].bullets[0].text = 'Supported planning for 20+ accounts using Postgres.';
  assert.equal(check(v).draft.bullets[0].text, v.roles[0].bullets[0].text);
  v.roles[0].bullets[0].text = 'Supported planning for 999 accounts using Postgres.';
  assert.equal(check(v, { resumeText: resumeText + '\nMapTool 999', resumeRead: { ...resumeRead, skills: { tools: ['Postgres', 'Kafka', 'MapTool 999'] } } }).draft.bullets[0].text, ledger.claims[0].text, 'skills cannot supply bullet numbers');
});
test('L3 cross-role basedOn fails shape and retries exactly once', async () => {
  const bad = response(); bad.roles[0].bullets[0].basedOn = 'B1';
  const stub = provider([bad, response()]); const out = await api('runLean')({ ...input(), pin: { ...pin, fallback: { stages: { '*': pin } } }, fetchImpl: stub.fetchImpl });
  assert.equal(stub.requests.length, 2); assert.equal(out.disposition, 'REVIEW');
  assert.equal(out.draft.bullets[0].claimId, 'claim-1');
});
test('L4 invented Meta and TikTok fall back to the source', () => {
  const v = response(); v.roles[0].bullets[0].text += ' Used Meta and TikTok.';
  assert.equal(check(v).draft.bullets[0].text, ledger.claims[0].text);
});
test('L5 posting salary and benefits cannot support letter prose', () => {
  const v = response(); v.letter.hook += ' I earned $180000 in salary.';
  v.letter.companyInsight += ' I used Meta rewards and 30 days of leave.';
  const c = check(v); assert.equal(c.disposition, 'REVIEW');
  assert.doesNotMatch(Object.values(c.draft.letter).join(' '), /180000|Meta|30 days/);
});
test('L6 skills outside saved skills are removed', () => {
  const v = response(); v.skills.push('TikTok'); assert.deepEqual(check(v).skills, ['Postgres', 'Kafka']);
});
test('L7 employer and role facts come from ledger; titles are never offered as bullets', () => {
  const v = response(); v.roles[0].bullets[0].text += ' At FakeCorp as Director in 2030.';
  const m = model(v); const entries = m.documents.resume.sections.find(s => s.kind === 'experience').entries;
  assert.match(entries[0].org, /^Northwind/); assert.deepEqual(entries[0].roles.map(r => runsToText(r.seat)), ledger.employers[0].roles.map(r => r.title));
  assert.doesNotMatch(JSON.stringify(m), /FakeCorp|2030/);
  const prompt = api('buildLeanPrompt')(input());
  assert.doesNotMatch(prompt.userText.split('BULLETS\n')[1].split('\nSKILLS')[0], /role-only|profile-only|Profile only claim/);
});
test('L8 education and certificates are literal and optional, including unbulleted text', async () => {
  const m = model(); const lines = m.documents.resume.sections.filter(s => s.kind === 'credentials').flatMap(s => s.lines.map(l => runsToText(l.runs)));
  assert.deepEqual(lines, ['State College — BA Economics', 'Data Certificate']);
  const v = model(response(), { resumeRead: { education: ['Imaginary University'], certifications: [] }, resumeText: 'Jordan Rivera\nField Analyst' });
  assert.equal(v.documents.resume.sections.some(s => s.kind === 'credentials'), false);
  const raw = await readFile(new URL('./fixtures/lean/resume-unbulleted.txt', import.meta.url), 'utf8');
  const prompt = api('buildLeanPrompt')(input({ resumeText: raw })); assert.ok(prompt.userText.includes(raw));
});
test('L9 lean dates and verified alias display; manager reaches the letter rail', () => {
  const m = model(); const e = m.documents.resume.sections.find(s => s.kind === 'experience').entries;
  assert.match(e[0].org, /\(formerly Entercom\)/); assert.ok(e[0].meta.includes('Sep 2017 – 2026'));
  assert.ok(e[1].meta.includes('2024 – Present')); assert.equal(m.documents.coverLetter.salutation, 'Dear Casey,');
});
test('L10 resume-only publish skips absent artifacts and preserves existing letter PDF', async () => {
  const dir = await mkdtemp(join(sandbox, 'single-')); await writeFile(join(dir, 'cover-letter.pdf'), 'previous letter');
  const v = response(); delete v.letter;
  const { result } = await pipeline('resume', [v], { dir }); assert.equal(result.adopted, true);
  assert.equal(await readFile(join(dir, 'cover-letter.pdf'), 'utf8'), 'previous letter');
  await assert.rejects(readFile(join(dir, 'outline.json')), { code: 'ENOENT' });
});
test('L11 cache separates engine and lean prompt versions', () => {
  const base = { jdHash: 'sha256:1', ledgerHash: 'sha256:2', templateFamily: 'signal', templateVersion: '1.4', feature: 'both' };
  assert.notEqual(pipelineCacheKey(base), pipelineCacheKey({ ...base, engine: 'lean', leanPromptVersion: 'v1' }));
  assert.notEqual(pipelineCacheKey({ ...base, engine: 'lean', leanPromptVersion: 'v1' }), pipelineCacheKey({ ...base, engine: 'lean', leanPromptVersion: 'v2' }));
});
test('L12 engine off keeps golden legacy request bodies; overrides require eval mode', async () => {
  const golden = await json(new URL('./fixtures/lean/', import.meta.url), 'legacy-requests.json');
  for (const providerName of ['gemini', 'openai', 'anthropic', 'local']) {
    let body;
    await runJsonStage({ pin: { ...pin, provider: providerName, resolvedModel: 'stub', baseUrl: 'https://example.com/v1' }, systemPrompt: 's', userText: 'u', fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body); return { ok: true, json: async () => providerName === 'gemini' ? { candidates: [{ content: { parts: [{ text: '{}' }] } }] } : providerName === 'anthropic' ? { content: [{ type: 'text', text: '{}' }] } : { choices: [{ message: { content: '{}' } }] } };
    } }); assert.deepEqual(body, golden[providerName]);
  }
  const previous = { material: process.env.MATERIALS_ENGINE, eval: process.env.JOBBORED_EVAL };
  try {
    delete process.env.MATERIALS_ENGINE; delete process.env.JOBBORED_EVAL;
    const req = { slug: 'role', company: 'Example', title: 'Analyst', feature: 'resume', resume: { source: 'upload', filename: 'resume.txt', text: resumeText }, engine: 'lean' };
    assert.equal(normalizeRequestBody(req).engine, undefined);
    process.env.JOBBORED_EVAL = '1'; assert.equal(normalizeRequestBody(req).engine, 'lean');
    delete process.env.JOBBORED_EVAL; process.env.MATERIALS_ENGINE = 'lean'; assert.equal(normalizeRequestBody(req).engine, 'lean');
  } finally { for (const [key, value] of [['MATERIALS_ENGINE', previous.material], ['JOBBORED_EVAL', previous.eval]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test('L13 native schema and per-call temperature; compatible providers keep json_object', async () => {
  const schema = { type: 'object', properties: { needs: { type: 'array', items: { type: 'string' } } }, required: ['needs'], additionalProperties: false };
  for (const providerName of ['gemini', 'openai', 'anthropic', 'local', 'openrouter']) {
    let body;
    await runJsonStage({ pin: { ...pin, provider: providerName, baseUrl: 'https://example.com/v1' }, systemPrompt: 's', userText: 'u', responseSchema: schema, temperature: 0.3, fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body); const text = '{"needs":["routes"]}'; return { ok: true, json: async () => providerName === 'gemini' ? { candidates: [{ content: { parts: [{ text }] } }] } : providerName === 'anthropic' ? { content: [{ type: 'text', text }] } : { choices: [{ message: { content: text } }] } };
    } });
    if (providerName === 'gemini') { assert.deepEqual(body.generationConfig.responseSchema.properties, schema.properties); assert.deepEqual(body.generationConfig.responseSchema.required, schema.required); assert.equal(body.generationConfig.responseSchema.additionalProperties, undefined); assert.equal(body.generationConfig.temperature, 0.3); }
    else if (providerName === 'openai') { assert.deepEqual(body.response_format.json_schema.schema, schema); assert.equal(body.response_format.json_schema.strict, true); assert.equal(body.temperature, 0.3); }
    else if (providerName === 'anthropic') { assert.deepEqual(body.output_config.format.schema, schema); assert.equal(body.temperature, undefined); }
    else { assert.equal(body.response_format.type, 'json_object'); assert.equal(body.temperature, 0.3); }
  }
});
test('L14 one stubbed call renders PDFs and READY qa.v3 with ledger claimIds', async () => {
  const { result, dir, stub } = await pipeline(); assert.equal(stub.requests.length, 1); assert.equal(result.qa.disposition, 'READY');
  assert.equal(result.adopted, true); const qa = await json(dir, 'qa.resume.json');
  const ajv = new Ajv2020({ strict: false }); const validate = ajv.compile(await json(new URL('../schemas/', import.meta.url), 'materials-qa.v3.schema.json'));
  assert.equal(validate(qa), true, JSON.stringify(validate.errors)); assert.deepEqual(qa.reviews, []); assert.deepEqual(qa.ratings, []);
  assert.equal(validate(await json(dir, 'qa.letter.json')), true, JSON.stringify(validate.errors));
  assert.equal((await json(dir, 'run.json')).engine, 'lean');
  for (const entry of result.model.documents.resume.sections.find(s => s.kind === 'experience').entries) {
    assert.ok(entry.bullets.length >= 2 && entry.bullets.length <= 5);
    assert.ok(entry.bullets.every(b => ledger.claims.some(c => c.id === b.claimId && c.kind !== 'role')));
  }
  assert.match(await readFile(join(dir, 'resume.pdf'), 'utf8'), /^%PDF/);
  assert.match(await readFile(join(dir, 'cover-letter.pdf'), 'utf8'), /^%PDF/);
  const draft = await json(dir, 'draft.json'); assert.ok(words(Object.values(draft.letter).join(' ')) >= 120);
  assert.deepEqual(result.stages.filter(s => s.llm).map(s => s.stage), ['write']);
  const provenance = (await json(dir, 'lean.json')).provenance;
  assert.ok(provenance.some(p => p.field === 'letter.proof1' && p.facts.some(f => f.token === '620' && f.source.includes('620 vans'))));
  assert.ok(provenance.every(p => p.facts.every(f => typeof f.source === 'string' && f.source.length > 0)));
});
test('L15 failed image has a monogram fallback in rendered HTML', () => {
  const m = model(); m.documents.resume.sections.find(s => s.kind === 'experience').entries[0].logo = { src: 'https://example.com/missing.png', alt: 'Northwind', source: 'favicon', shape: 'mark' };
  const html = renderDocument(m, 'resume'); assert.match(html, /onerror=.*data:image\/svg\+xml/);
  const handler = html.match(/<img[^>]*src="https:\/\/example.com\/missing.png"[^>]*onerror="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const img = { src: 'https://example.com/missing.png', onerror: true }; Function(handler).call(img);
  assert.match(img.src, /^data:image\/svg\+xml/); assert.equal(img.onerror, null);
});
test('L16 template regenerate of a lean run works and preserves engine metadata', async () => {
  const root = await mkdtemp(join(sandbox, 'regen-')); const dir = join(root, 'harbor-role'); await mkdir(dir);
  await pipeline('both', [response()], { dir });
  const result = await regeneratePackage({ slug: 'harbor-role', template: 'signal' }, { applicationsRoot: root, pdfSession: fakeSession, readSavedResume: async () => null, targetLogoLoader: async () => null, employerLogoLoader: async () => [] });
  assert.equal(result.ok, true); assert.equal((await json(dir, 'run.json')).engine, 'lean');
  assert.ok((await json(dir, 'writer-sources.json')).resume.length);
});
test('L17 one employer entry across three roles keeps node IDs unique', () => {
  const nodes = deriveNodes(model()); assert.equal(nodes.length, new Set(nodes.map(n => n.id)).size);
  assert.equal(nodes.filter(n => n.kind === 'bullet').length, 6);
});
test('L18 editing an employer with five bullets succeeds', () => {
  const v = response(); v.roles[1].bullets.push({ text: ledger.claims[3].text, basedOn: 'B2' });
  const m = model(v); const node = deriveNodes(m).find(n => n.kind === 'bullet');
  const edited = applyOps(m, [{ op: 'replace', opId: 'edit-1', node: node.id, text: node.text + ' Used field reports.' }]);
  assert.equal(edited.documents.resume.sections.find(s => s.kind === 'experience').entries[0].bullets.length, 5);
});
test('L19 insert into a multi-role employer maintains visible role membership', () => {
  const m = model(); const node = deriveNodes(m).find(n => n.kind === 'bullet');
  const text = 'Supported planning for 21+ accounts using Postgres and field reports.';
  const edited = applyOps(m, [{ op: 'insert', opId: 'insert-1', after: node.id, claimId: 'inserted', text }]);
  assert.match(renderDocument(edited, 'resume'), /field reports/);
  assert.ok(edited.documents.resume.sections.find(s => s.kind === 'experience').entries[0].roles[0].claimIds.includes('inserted'));
});
test('L20 first-run shape FAIL is held; only two calls, no default', async () => {
  const bad = response(); bad.roles[0].bullets[0].basedOn = 'missing';
  const { result, dir, stub } = await pipeline('both', [bad]);
  assert.equal(stub.requests.length, 2); assert.equal(result.outcome, 'held'); assert.equal(result.qa.disposition, 'FAIL');
  await assert.rejects(readFile(join(dir, 'run.json')), { code: 'ENOENT' });
  assert.equal((await json(join(dir, 'runs', 'lean-1'), 'run.json')).held !== null, true);
});
test('L21 fabricated earlier line falls back to its own source', () => {
  const v = response(); v.earlier[0].text = 'Led TikTok delivery for 999 clients.';
  assert.equal(check(v).draft.earlier[0].text, ledger.claims[8].text);
});
test('L22 statement tools are checked against the resume', () => {
  const v = response(); v.statement += ' Used TikTok.'; assert.doesNotMatch(check(v).draft.statement, /TikTok/);
  v.statement = 'Zendesk supports route tools.'; assert.equal(check(v).draft.statement, '', 'sentence-initial proper names still need evidence');
});
test('L23 supported cannot become led; final fallback rechecked', () => {
  const v = response(); v.roles[0].bullets[0].text = 'Led planning for 21+ accounts using Postgres.';
  const c = check(v); assert.equal(c.draft.bullets[0].text, ledger.claims[0].text);
  assert.equal(c.disposition, 'READY'); assert.ok(c.notes.some(n => n.check === 'ownership'));
  assert.equal(c.provenance.find(p => p.claimId === 'claim-1').source, ledger.claims[0].text);
});
