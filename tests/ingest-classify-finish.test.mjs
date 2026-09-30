import assert from 'node:assert/strict';
import { it } from 'node:test';
import { structureResume } from '../server/materials-resume-structure-model.mjs';
import { validateIngestResult } from '../server/resume-ingest-contract.mjs';

const base = ['EXPERIENCE', 'Contoso', 'Analyst | 2022 — Present', '• Built fictional reports.'];
const primary = { employers: [{ name: 'Contoso', headerLine: 2, roles: [{ title: 'Analyst', line: 3 }], bullets: [{ text: 'Built fictional reports.', line: 4 }] }] };

async function run(tail, reason = 'heading', headings = []) {
  let reads = 0;
  const result = await structureResume({
    lsrc: [...base, ...tail].join('\n'),
    pin: { provider: 'gemini', model: 'fictional' },
    callStage: async (request) => {
      if (request.stage === 'resume.classify') return { lines: [...request.userText.matchAll(/^C(\d+): /gmu)].map(([, id]) => ({ line: `C${id}`, kind: 'not_work', reason })) };
      return ++reads === 1 ? { ...structuredClone(primary), headings } : { employers: [], bullets: [] };
    },
  });
  assert.equal(validateIngestResult(result).ok, true);
  return result;
}

for (const line of [
  'User Experience Designer', 'Customer Experience Manager', 'Employment Specialist',
  'Director of Customer Experience', 'Fabrikam — User Experience Designer 2015 — 2018',
  'Redesigned the checkout experience', 'Product Designer',
  'CUSTOMER EXPERIENCE', 'Experience Designer', 'Professional Experience Manager',
  'Experience & Customer', 'Experience AND Designer', 'Professional Employment Specialist:',
]) {
  it(`FABLE-R3-1 uncited ${line} stays flagged despite a wrong heading reply`, async () => {
    for (const tags of [[], [5]]) {
      const result = await run([line], 'heading', tags);
      assert.ok(result.couldntPlace.some((item) => item.lines[0] === 5 && item.excerpt === line));
      assert.deepEqual(result.review.cleared, []);
      if (line.startsWith('Fabrikam')) {
        assert.equal(result.status, 'ready_with_review');
        assert.ok(result.missingEmployers.some((item) => item.displayName === line));
      }
    }
  });
}

it('FABLE-R3-1 User Experience remains in SKILLS without starting experience coverage', async () => {
  const result = await run(['SKILLS', 'User Experience', 'Figma', 'Sketch', 'Adobe XD'], 'skill');
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.couldntPlace, []);
  assert.deepEqual(result.missingEmployers, []);
  assert.deepEqual(result.review.cleared, []);
});

for (const heading of [
  'EXPERIENCE', 'WORK EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'RELEVANT EXPERIENCE',
  'ADDITIONAL EXPERIENCE', 'OTHER EXPERIENCE', 'SELECTED EXPERIENCE',
  'TEACHING EXPERIENCE', 'VOLUNTEER EXPERIENCE', 'LEADERSHIP EXPERIENCE', 'EARLIER EXPERIENCE',
  'EMPLOYMENT', 'EMPLOYMENT HISTORY', 'WORK HISTORY', 'CAREER HISTORY', 'INTERNSHIPS', 'MILITARY SERVICE',
  'EXPERIENCE & LEADERSHIP', 'Experience AND Teaching', 'EXPERIENCE & WORK HISTORY',
  'PAST EMPLOYMENT', 'RELEVANT WORK HISTORY', 'PRIOR CAREER HISTORY', 'CAREER EXPERIENCE',
  'MILITARY EXPERIENCE', 'VOLUNTEER WORK', 'VOLUNTEERING', 'VOLUNTEER',
  'Professional Employment',
  'Founder Work / Independent Projects', 'Selected Ventures',
]) {
  it(`FABLE-R3-1 ${heading} ends SKILLS and protects the following omitted job`, async () => {
    for (const sourceHeading of [heading, `${heading}:`, `${heading} 2`]) {
      const result = await run(['SKILLS', 'Figma', sourceHeading, 'Fabrikam | Engineer | 2015 — 2018', 'Led fictional workshops'], 'certification');
      assert.equal(result.status, 'ready_with_review', sourceHeading);
      assert.ok(!result.couldntPlace.some((item) => item.lines[0] === 7), sourceHeading);
      for (const number of [8, 9]) assert.ok(result.couldntPlace.some((item) => item.lines[0] === number), `${sourceHeading}: L${number}`);
      assert.ok(result.missingEmployers.some((item) => item.displayName.includes('Fabrikam')), sourceHeading);
      assert.deepEqual(result.review.cleared, [], sourceHeading);
    }
  });
}

it('FABLE-R3-1 EXPERIENCE with a date range is covered as a whole-line section heading', async () => {
  for (const heading of ['EXPERIENCE 2019 — 2021', 'Earlier Experience 2015 — 2017', 'EXPERIENCE 2019 - Present:', 'Earlier 2014 — 2017']) {
    const result = await run([heading]);
    assert.deepEqual(result.couldntPlace, []);
    assert.deepEqual(result.missingEmployers, []);
  }
});

for (const qualifier of ['WORK', 'PROFESSIONAL', 'RELEVANT', 'ADDITIONAL', 'OTHER', 'SELECTED', 'TEACHING', 'VOLUNTEER', 'LEADERSHIP', 'EARLIER', 'PAST', 'PRIOR', 'CAREER', 'MILITARY']) {
  it(`FABLE-R3-1 closed qualifier ${qualifier} permits dated and mixed-case experience headings`, async () => {
    const heading = `${qualifier.toLowerCase()} Experience 2015 – 2017:`;
    const result = await run([heading]);
    assert.deepEqual(result.couldntPlace, []);
    assert.deepEqual(result.missingEmployers, []);
    assert.deepEqual(result.review.cleared, []);
  });
}
