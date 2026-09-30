import assert from 'node:assert/strict';
import { it } from 'node:test';
import { structureResume } from '../server/materials-resume-structure-model.mjs';
import { validateIngestResult } from '../server/resume-ingest-contract.mjs';

const pin = { provider: 'gemini', model: 'fictional' };
const base = ['EXPERIENCE', 'Contoso', 'Analyst | 2022 — Present', '• Built fictional reports.'];
const primary = { employers: [{ name: 'Contoso', headerLine: 2, roles: [{ title: 'Analyst', line: 3 }], bullets: [{ text: 'Built fictional reports.', line: 4 }] }] };
const ids = (request) => [...request.userText.matchAll(/^C(\d+): (.*)$/gmu)].map(([, id, text]) => ({ line: `C${id}`, text }));
const reply = (request, kind = 'not_work', reason = 'heading') => ({ lines: ids(request).map(({ line }) => ({ line, kind, reason: kind === 'not_work' ? reason : null })) });
async function run(tail = [], classifier = (r) => reply(r), { text = [...base, ...tail].join('\n'), read = primary } = {}) {
  const classifyCalls = [];
  let reads = 0;
  const result = await structureResume({ lsrc: text, pin, callStage: async (request) => {
    if (request.stage === 'resume.classify') { classifyCalls.push(request); return classifier(request); }
    return ++reads === 1 ? structuredClone(read) : { employers: [], bullets: [] };
  } });
  return { result, classifyCalls };
}
const chain = (location) => ({
  text: ['EXPERIENCE', 'Contoso', 'Analyst', location, '2019 — 2021', '• Built fictional reports.'].join('\n'),
  read: { employers: [{ name: 'Contoso', headerLine: 2, roles: [{ title: 'Analyst', line: 3 }], bullets: [{ text: 'Built fictional reports.', line: 6 }] }] },
});

// Each spelling must end education context even when the model calls work a credential.
for (const heading of ['WORK EXPERIENCE', 'ADDITIONAL EXPERIENCE:', 'RELEVANT EXPERIENCE:', 'PROFESSIONAL EXPERIENCE:', 'TEACHING EXPERIENCE:', 'VOLUNTEER EXPERIENCE:', 'LEADERSHIP EXPERIENCE:', 'PAST EMPLOYMENT:', 'RELEVANT WORK HISTORY:', 'EXPERIENCE & LEADERSHIP', 'Employment History']) {
  it(`ASTRA-R3-1 ${heading} ends the non-experience section`, async () => {
    const { result } = await run(['EDUCATION', 'Bachelor of Arts | Fictional University | 2017', heading, 'Fabrikam | Engineer | 2015 — 2018', 'Led fictional rollout across three sites'], (r) => reply(r, 'not_work', 'certification'));
    assert.equal(result.status, 'ready_with_review');
    for (const line of [8, 9]) assert.ok(result.couldntPlace.some((item) => item.lines[0] === line));
    assert.ok(!result.couldntPlace.some((item) => item.lines[0] === 7), 'the experience heading itself is covered');
    assert.ok(result.missingEmployers.some((item) => item.displayName.includes('Fabrikam')));
    assert.deepEqual(result.review.cleared, []);
  });
}
for (const accomplishment of ['Led fictional employment programs.', 'Built experience dashboards', 'Maintained work history records']) {
  it(`ASTRA-R3-1 work prose stays flagged: ${accomplishment}`, async () => {
    const { result } = await run([accomplishment], (r) => reply(r));
    assert.ok(result.couldntPlace.some((item) => item.lines[0] === 5));
    assert.deepEqual(result.review.cleared, []);
  });
}

for (const title of ['Director, Sales', 'Manager, Operations', 'Director, IT', 'Manager, HR', 'Analyst, QA', 'Director, Canada', 'Senior Director, IT', 'Regional Manager, UK', 'Business Analyst, CA', 'Engineer, UK', 'Chief Revenue Officer, US', 'VP, Canada', 'Founder, FR']) {
  it(`ASTRA-R3-2 ${title} cannot be covered by a wrong metadata reply`, async () => {
    const text = ['EXPERIENCE', 'Contoso', title, '2019 — 2021', '• Built fictional reports.'].join('\n');
    const read = { employers: [{ name: 'Contoso', headerLine: 2, roles: [], bullets: [{ text: 'Built fictional reports.', line: 5 }] }] };
    const { result } = await run([], (r) => reply(r), { text, read });
    assert.equal(result.status, 'ready_with_review');
    assert.ok(result.couldntPlace.some((item) => item.lines[0] === 3));
    assert.deepEqual(result.employers[0].roles, []);
    assert.ok(!result.review.cleared.some((item) => item.line === 3));
    assert.ok(!result.notes.some((note) => note.kind === 'header_metadata' && note.line === 3));
  });
}
it('ASTRA-R3-2 an ungrounded company line cannot gain metadata coverage', async () => {
  const { result } = await run([], (r) => reply(r), chain('Fabrikam Labs'));
  assert.ok(result.couldntPlace.some((item) => item.lines[0] === 4));
  assert.ok(!result.review.cleared.some((item) => item.line === 4));
});
it('ASTRA-R3-2 a repeated grounded company name plus a region is not location-only', async () => {
  const { result } = await run([], (r) => reply(r), chain('Contoso, AR'));
  assert.ok(result.couldntPlace.some((item) => item.lines[0] === 4));
  assert.ok(!result.review.cleared.some((item) => item.line === 4));
});
for (const location of ['Springfield, AR', 'Remote', 'Springfield, Arkansas']) {
  it(`ASTRA-R3-2 ${location} and its date have source-text audit entries`, async () => {
    const { result } = await run([], (r) => reply(r), chain(location));
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.couldntPlace, []);
    assert.deepEqual(result.review.cleared, [
      { line: 4, text: location, reason: 'heading' },
      { line: 5, text: '2019 — 2021', reason: 'heading' },
    ]);
    for (const line of [4, 5]) assert.ok(result.notes.some((note) => note.kind === 'classified_not_work' && note.line === line && note.reason === 'heading'));
    assert.equal(validateIngestResult(result).ok, true);
  });
}
it('ASTRA-R3-2 an invalid metadata row remains flagged and absent from the audit clears', async () => {
  const { result } = await run([], (r) => ({ lines: ids(r).map(({ line, text }) => ({ line, kind: 'not_work', reason: text === 'Remote' ? 'award' : 'heading' })) }), chain('Remote'));
  for (const line of [4, 5]) assert.ok(result.couldntPlace.some((item) => item.lines[0] === line));
  assert.deepEqual(result.review.cleared, []);
});

for (const title of ['Certified Nursing Assistant', 'Certified Instructor', 'Certified Master Trainer']) {
  it(`ASTRA-R3-3 ${title} with a single year reaches classification and stays flagged as work`, async () => {
    const header = `${title} | Fictional University | 2016`;
    const { result, classifyCalls } = await run(['EDUCATION', header], (r) => reply(r, 'work'));
    assert.equal(classifyCalls.length, 1);
    assert.ok(ids(classifyCalls[0]).some((item) => item.text === header));
    assert.ok(result.couldntPlace.some((item) => item.lines[0] === 6));
    assert.ok(result.missingEmployers.some((item) => item.displayName === header));
    assert.equal(result.status, 'ready_with_review');
    assert.deepEqual(result.review.cleared, []);
    const control = await run(['EDUCATION', header], (r) => reply(r, 'not_work', 'certification'));
    assert.deepEqual(control.result.review.cleared, [{ line: 6, text: header, reason: 'certification' }]);
  });
}
it('ASTRA-R3-3 a real degree field cannot exempt a separated job field with a single year', async () => {
  const header = 'Master of Science | Instructor | Fictional University | 2016';
  const { result, classifyCalls } = await run(['EDUCATION', header], (r) => reply(r, 'work'));
  assert.equal(classifyCalls.length, 1);
  assert.ok(result.couldntPlace.some((item) => item.lines[0] === 6));
  assert.deepEqual(result.review.cleared, []);
});
it('ASTRA-R3-3 a separated certificate with a single year is a classifier candidate', async () => {
  const header = 'Certificate in Design | Fictional University | 2016';
  const { result, classifyCalls } = await run(['EDUCATION', header], (r) => reply(r, 'unsure'));
  assert.equal(classifyCalls.length, 1);
  assert.ok(result.couldntPlace.some((item) => item.lines[0] === 6));
});
it('ASTRA-R3-3 a pure degree with a single year keeps its legacy exemption', async () => {
  const { result, classifyCalls } = await run(['EDUCATION', 'Bachelor of Arts | Fictional University | 2016'], (r) => reply(r, 'work'));
  assert.equal(result.status, 'ready');
  assert.equal(classifyCalls.length, 0);
  assert.deepEqual(result.review.cleared, []);
});

for (const location of ['Toronto, ON', 'London, UK', 'London, GBR', 'Fictional City, XX', 'Fictional City, XYZ', 'Toronto, Canada', 'London, United Kingdom', 'Paris, France', 'Tokyo, Japan', 'Little Rock, AR (Hybrid)']) {
  it(`ASTRA-R3-4 ${location} is audited location metadata`, async () => {
    const { result } = await run([], (r) => reply(r), chain(location));
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.couldntPlace, []);
    assert.deepEqual(result.review.cleared, [
      { line: 4, text: location, reason: 'heading' },
      { line: 5, text: '2019 — 2021', reason: 'heading' },
    ]);
  });
}
it('ASTRA-R3-4 an unknown full region name stays visible despite a heading reply', async () => {
  const { result } = await run([], (r) => reply(r), chain('Fictional City, Operations'));
  assert.ok(result.couldntPlace.some((item) => item.lines[0] === 4));
  assert.deepEqual(result.review.cleared, []);
});

for (const heading of ['LICENSES AND CERTIFICATIONS', 'EDUCATION AND CERTIFICATIONS:', 'CERTIFICATIONS AND LICENSES', 'CERTIFICATIONS AND LANGUAGES:', 'LANGUAGES AND CERTIFICATIONS']) {
  it(`ASTRA-R3-5 ${heading} accounts the heading and permits an audited credential clear`, async () => {
    const { result } = await run([heading, 'PMP — 2021'], (r) => reply(r, 'not_work', 'certification'));
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.couldntPlace, []);
    assert.deepEqual(result.review.cleared, [{ line: 6, text: 'PMP — 2021', reason: 'certification' }]);
    const control = await run([heading, 'PMP — 2021'], (r) => reply(r, 'work'));
    assert.ok(control.result.couldntPlace.some((item) => item.lines[0] === 6));
    assert.ok(!control.result.couldntPlace.some((item) => item.lines[0] === 5));
  });
}
