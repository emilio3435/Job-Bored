import assert from 'node:assert/strict';
import { it } from 'node:test';
import { structureResume } from '../server/materials-resume-structure-model.mjs';

const pin = { provider: 'gemini', model: 'fictional' };
const base = ['EXPERIENCE', 'Contoso', 'Analyst | 2022 — Present', '• Built fictional reports.'];
const primary = { employers: [{ name: 'Contoso', headerLine: 2, roles: [{ title: 'Analyst', line: 3 }], bullets: [{ text: 'Built fictional reports.', line: 4 }] }] };
const ids = (request) => [...request.userText.matchAll(/^C(\d+): (.*)$/gmu)].map(([, id, text]) => ({ line: `C${id}`, text }));
const reply = (request, kind = 'not_work', reason = 'education') => ({ lines: ids(request).map(({ line }) => ({ line, kind, ...(kind === 'not_work' ? { reason } : {}) })) });
async function run(tail, classifier = (r) => reply(r), options = {}) {
  const { text = [...base, ...tail].join('\n'), read = primary } = options;
  const requests = [];
  let reads = 0;
  const result = await structureResume({ lsrc: text, pin, callStage: async (request) => {
    requests.push(request);
    if (request.stage === 'resume.classify') return classifier(request);
    return ++reads === 1 ? structuredClone(read) : { employers: [], bullets: [] };
  } });
  return { result, classifyCalls: requests.filter((r) => r.stage === 'resume.classify') };
}

for (const [section, title] of [['EDUCATION', 'Certified Nursing Assistant'], ['TEACHING EXPERIENCE', 'Certified Instructor']]) {
  it(`FABLE-R2-1 omitted ${title} with separators and dates is classified and stays flagged as work`, async () => {
    const header = `${title} | Fictional University | 2012 — 2016`;
    const { result, classifyCalls } = await run([section, header], (r) => reply(r, 'work'));
    assert.equal(classifyCalls.length, 1);
    assert.ok(ids(classifyCalls[0]).some((item) => item.text === header));
    assert.equal(result.status, 'ready_with_review');
    assert.ok(result.couldntPlace.some((item) => item.lines[0] === 6));
    assert.ok(result.missingEmployers.some((item) => item.displayName === header));
    assert.deepEqual(result.review.cleared, []);
  });
}
it('FABLE-R2-1 separated degree with a date range can be classified as education', async () => {
  const degree = 'Master of Economics | Fictional University | 2012 — 2016';
  const { result, classifyCalls } = await run(['EDUCATION', degree]);
  assert.equal(classifyCalls.length, 1);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.review.cleared, [{ line: 6, text: degree, reason: 'education' }]);
});

it('FABLE-R2-2 ungrounded additional experience cannot be cleared by a valid wrong reply', async () => {
  const { result } = await run(['EDUCATION', 'Bachelor of Science | Fictional University | 2017', 'ADDITIONAL EXPERIENCE', 'Fabrikam | Engineer | 2015 — 2018', 'Led fictional rollout across three sites'], (r) => reply(r, 'not_work', 'certification'));
  assert.equal(result.status, 'ready_with_review');
  for (const line of [8, 9]) assert.ok(result.couldntPlace.some((item) => item.lines[0] === line));
  assert.ok(result.missingEmployers.some((item) => item.displayName.includes('Fabrikam')));
  assert.deepEqual(result.review.cleared, []);
});
it('FABLE-R2-2 omitted first job before any grounded employer stays flagged', async () => {
  const text = ['EXPERIENCE', 'Fabrikam | Engineer | 2015 — 2018', 'Led fictional rollout across three sites', ...base.slice(1)].join('\n');
  const read = structuredClone(primary);
  read.employers[0].headerLine = 4;
  read.employers[0].roles[0].line = 5;
  read.employers[0].bullets[0].line = 6;
  const { result } = await run([], (r) => reply(r, 'not_work', 'certification'), { text, read });
  assert.equal(result.status, 'ready_with_review');
  assert.ok(result.couldntPlace.some((item) => item.lines[0] === 2));
  assert.ok(result.missingEmployers.some((item) => item.displayName.includes('Fabrikam')));
  assert.deepEqual(result.review.cleared, []);
});
it('FABLE-R2-2 a title above the first grounded company cannot be cleared', async () => {
  const text = ['EXPERIENCE', 'Engineer', 'Contoso | 2019 — 2021', '• Built fictional reports.'].join('\n');
  const read = { employers: [{ name: 'Contoso', headerLine: 3, roles: [], bullets: [{ text: 'Built fictional reports.', line: 4 }] }] };
  const { result } = await run([], (r) => reply(r), { text, read });
  assert.ok(result.couldntPlace.some((item) => item.lines[0] === 2));
  assert.deepEqual(result.review.cleared, []);
});

for (const location of ['Remote', 'Springfield, Arkansas', 'Little Rock, AR (Hybrid)', 'London, United Kingdom', 'Springfield, AR | 2019 — 2021']) {
  it(`FABLE-R2-3 ${location} tagged heading belongs to its grounded metadata chain`, async () => {
    const mixed = location.includes('|');
    const text = ['EXPERIENCE', 'Contoso', 'Analyst', location, ...(mixed ? [] : ['2019 — 2021']), '• Built fictional reports.'].join('\n');
    const read = { employers: [{ name: 'Contoso', headerLine: 2, roles: [{ title: 'Analyst', line: 3 }], bullets: [{ text: 'Built fictional reports.', line: mixed ? 5 : 6 }] }] };
    const { result, classifyCalls } = await run([], (r) => reply(r, 'not_work', 'heading'), { text, read });
    assert.equal(classifyCalls.length, 1);
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.couldntPlace, []);
    assert.deepEqual(result.missingEmployers, []);
    assert.deepEqual(result.review.cleared, [], 'work-section metadata is header coverage, not a non-work clear');
    assert.ok(result.notes.some((note) => note.kind === 'header_metadata' && note.line === 4 && [2, 3].includes(note.headerLine)));
    assert.match(classifyCalls[0].userText, /context metadata header L[23]:/u);
    for (const kind of ['work', 'unsure']) {
      const control = await run([], (r) => reply(r, kind), { text, read });
      assert.ok(control.result.couldntPlace.some((item) => item.lines[0] === 4));
      assert.equal(control.result.status, 'ready_with_review');
    }
  });
}
it('FABLE-R2-3 a location is not metadata outside its contiguous three-line chain', async () => {
  const { result } = await run(['Trained fictional teams.', 'Remote'], (r) => reply(r, 'not_work', 'heading'));
  assert.ok(result.couldntPlace.some((item) => item.lines[0] === 6));
  assert.deepEqual(result.review.cleared, []);
});
it('FABLE-R2-3 invalid location classification cannot cover a downstream date', async () => {
  const text = ['EXPERIENCE', 'Contoso', 'Analyst', 'Remote', '2019 — 2021', '• Built fictional reports.'].join('\n');
  const read = { employers: [{ name: 'Contoso', headerLine: 2, roles: [{ title: 'Analyst', line: 3 }], bullets: [{ text: 'Built fictional reports.', line: 6 }] }] };
  const { result } = await run([], (r) => ({ lines: ids(r).map(({ line, text }) => ({ line, kind: 'not_work', reason: text === 'Remote' ? 'award' : 'heading' })) }), { text, read });
  for (const line of [4, 5]) assert.ok(result.couldntPlace.some((item) => item.lines[0] === line));
});

for (const heading of ['LICENSES & CERTIFICATIONS', 'EDUCATION & CERTIFICATIONS', 'CERTIFICATIONS & LICENSES', 'TRAINING', 'AWARDS', 'HONORS', 'CORE COMPETENCIES', 'ACADEMIC BACKGROUND', 'PUBLICATIONS', 'PROFESSIONAL DEVELOPMENT']) {
  it(`FABLE-R2-4 ${heading} creates an explicit non-experience section`, async () => {
    const line = heading === 'ACADEMIC BACKGROUND' ? 'M.Sc. | Fictional University | 2017' : 'PMP — 2021';
    const { result } = await run([heading, line], (r) => reply(r, 'not_work', heading === 'ACADEMIC BACKGROUND' ? 'education' : 'certification'));
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.couldntPlace, []);
    assert.deepEqual(result.review.cleared.map((item) => item.line), [6]);
    const control = await run([heading, line], (r) => reply(r, 'work'));
    assert.ok(control.result.couldntPlace.some((item) => item.lines[0] === 6));
    assert.ok(!control.result.couldntPlace.some((item) => item.lines[0] === 5), 'the source heading is accounted');
  });
}
it('FABLE-R2-4 bare M.Sc. under ACADEMIC BACKGROUND is classified', async () => {
  const { result } = await run(['ACADEMIC BACKGROUND', 'M.Sc.']);
  assert.deepEqual(result.review.cleared, [{ line: 6, text: 'M.Sc.', reason: 'education' }]);
});
it('FABLE-R2-4 VOLUNTEER is experience and does not permit non-work clears', async () => {
  const { result } = await run(['EDUCATION', 'VOLUNTEER', 'Fabrikam | Tutor | 2019 — 2021', 'Taught fictional workshops'], (r) => reply(r, 'not_work', 'education'));
  assert.equal(result.status, 'ready_with_review');
  for (const line of [7, 8]) assert.ok(result.couldntPlace.some((item) => item.lines[0] === line));
  assert.deepEqual(result.review.cleared, []);
});

for (const title of ['Director, IT', 'Manager, HR', 'Analyst, QA']) {
  it(`FABLE-R2-5 ${title} with an omitted role cannot be swallowed as location metadata`, async () => {
    const text = ['EXPERIENCE', 'Contoso', title, '2019 — 2021', '• Built fictional reports.'].join('\n');
    const read = { employers: [{ name: 'Contoso', headerLine: 2, roles: [], bullets: [{ text: 'Built fictional reports.', line: 5 }] }] };
    const { result } = await run([], (r) => reply(r, 'not_work', 'heading'), { text, read });
    assert.ok(result.couldntPlace.some((item) => item.lines[0] === 3));
    assert.equal(result.employers[0].roles.length, 0);
    assert.ok(!result.notes.some((note) => note.kind === 'header_metadata' && note.line === 3));
    assert.equal(result.status, 'ready_with_review');
  });
}

for (const [label, badRows] of [
  ['off-list reason', (row) => [{ ...row, reason: 'award' }]],
  ['unknown kind', (row) => [{ ...row, kind: 'degree' }]],
  ['missing reason', (row) => [{ line: row.line, kind: 'not_work' }]],
  ['duplicate ID', (row) => [row, row]],
  ['numeric ID', (row) => [{ ...row, line: 6 }]],
  ['context ID', (row) => [{ ...row, line: 'L6' }]],
]) {
  it(`FABLE-R2-6 ${label} stays flagged while a valid M.Sc. row is applied`, async () => {
    const { result } = await run(['EDUCATION', 'PMP — 2021', 'M.Sc. | Fictional University | 2017'], (r) => {
      const rows = reply(r).lines;
      return { lines: [...badRows(rows[0]), rows[1]] };
    });
    assert.ok(result.couldntPlace.some((item) => item.lines[0] === 6));
    assert.deepEqual(result.review.cleared.map((item) => item.line), [7]);
    assert.ok(!result.notes.some((note) => note.kind === 'classify_unavailable'));
    assert.ok(result.notes.some((note) => note.kind === 'classify_row_invalid'));
  });
}
it('FABLE-R2-6 an unknown ID does not invalidate unrelated valid rows', async () => {
  const { result } = await run(['EDUCATION', 'M.Sc. | Fictional University | 2017'], (r) => ({ lines: [...reply(r).lines, { line: 'C999', kind: 'not_work', reason: 'education' }] }));
  assert.deepEqual(result.review.cleared.map((item) => item.line), [6]);
  assert.ok(result.notes.some((note) => note.kind === 'classify_row_invalid'));
});
it('FABLE-R2-6 an invalid downstream date row stays flagged beside a valid metadata location', async () => {
  const text = ['EXPERIENCE', 'Contoso', 'Analyst', 'Remote', '2019 — 2021', '• Built fictional reports.'].join('\n');
  const read = { employers: [{ name: 'Contoso', headerLine: 2, roles: [{ title: 'Analyst', line: 3 }], bullets: [{ text: 'Built fictional reports.', line: 6 }] }] };
  const { result } = await run([], (r) => ({ lines: ids(r).map(({ line, text }) => ({ line, kind: 'not_work', reason: text === '2019 — 2021' ? 'award' : 'heading' })) }), { text, read });
  assert.ok(!result.couldntPlace.some((item) => item.lines[0] === 4));
  assert.ok(result.couldntPlace.some((item) => item.lines[0] === 5));
  assert.ok(result.notes.some((note) => note.kind === 'classify_row_invalid' && note.line === 5));
  assert.deepEqual(result.review.cleared, []);
});
for (const [provider, model] of [['openai', 'gpt-4o'], ['openrouter', 'openai/gpt-4o']]) {
  it(`FABLE-R2-6 ${provider} supports an enum json_schema on the classification wire`, async () => {
    let classificationRequests = 0;
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      const classify = body.messages.at(-1).content.includes('C1:');
      if (classify) {
        classificationRequests += 1;
        const format = body.response_format;
        assert.equal(format.type, 'json_schema');
        assert.equal(format.json_schema.strict, true);
        const schema = format.json_schema.schema;
        assert.equal(schema.additionalProperties, false);
        const item = schema.properties.lines.items;
        assert.equal(item.additionalProperties, false);
        assert.deepEqual(item.required, ['line', 'kind', 'reason']);
        assert.deepEqual(item.properties.kind.enum, ['not_work', 'work', 'unsure']);
        assert.ok(item.properties.reason.enum.includes('education'));
        assert.ok(item.properties.reason.enum.includes('heading'));
        assert.ok(item.properties.reason.enum.includes(null), 'work/unsure can give no non-work reason');
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(classify ? { lines: [{ line: 'C1', kind: 'not_work', reason: 'education' }] } : primary) } }] }) };
    };
    const result = await structureResume({ lsrc: [...base, 'EDUCATION', 'M.Sc. | Fictional University | 2017'].join('\n'), pin: { provider, model, apiKey: 'fictional', baseUrl: 'https://example.com/v1' }, fetchImpl, sleep: async () => {} });
    assert.equal(classificationRequests, 1);
    assert.deepEqual(result.review.cleared.map((item) => item.line), [6]);
  });
}
