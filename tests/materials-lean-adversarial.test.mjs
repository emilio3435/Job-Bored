import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLean, parseLeanNumbers } from '../server/materials-lean.mjs';
import { resumeText, jdText, ledger, resumeRead, response } from './fixtures/lean/fixture.mjs';
const check = (value, extra = {}) => checkLean({ ledger: structuredClone(ledger), resumeText, jdText, resumeRead, feature: 'both', value, ...extra });
const bullets = [
  ['F1-2 swapped count units', 1, 0, 'claim-3', 'Ran weekly readouts for 40 dispatch leads and 14 stores.'],
  ['F1-2 rounding from another unit', 1, 0, 'claim-3', 'Ran weekly readouts for 30+ dispatch leads and 40 stores.'],
  ['F1-3 designed and delivered ownership', 0, 0, 'claim-1', 'Designed and delivered planning for 21+ accounts using Postgres.'],
  ['F1-3 leading ownership', 0, 0, 'claim-1', 'Supported planning for 21+ accounts using Postgres, leading the team end to end.'],
  ['F1-2 number words and doubling', 0, 0, 'claim-1', 'Supported planning for 21+ accounts using Postgres, doubling revenue across fifty enterprise clients.'],
  // Fable's Kafka probe is explicitly allowed by the skills-line rule; use an absent tool here.
  ['F1-10 lowercase dbt tool', 0, 0, 'claim-1', 'Supported planning for 21+ accounts using Postgres and dbt.'],
  ['F1-2 reversed percentages', 0, 1, 'claim-2', 'Reduced missed windows from 4.3% to 9.1% for 620 vans.'],
  ['F1-2 joined 15yrs', 0, 0, 'claim-1', 'Supported planning for 21+ accounts using Postgres over 15yrs.'],
  ['F1-2 number moved to missed windows', 0, 1, 'claim-2', 'Reduced 620 missed windows from 9.1% to 4.3%.'],
  ['F1-3 lowercase director title', 0, 0, 'claim-1', 'Supported planning for 21+ accounts using Postgres as director of operations.'],
  ['F1-2 trailing unbound count', 0, 0, 'claim-1', 'Supported direct reports (21+).'],
];
for (const [name, role, bullet, claimId, text] of bullets) test(name, () => {
  const v = response(); v.roles[role].bullets[bullet].text = text;
  const c = check(v);
  assert.notEqual(c.draft.bullets.find(b => b.claimId === claimId)?.text, text);
  const expected = name.startsWith('F1-2') ? 'numbers' : name.includes('director title') ? 'credentials' : name.startsWith('F1-3') ? 'ownership' : 'names';
  assert.ok(c.notes.some(n => n.field === `bullet:${claimId}` && n.check === expected), `rejected by ${expected}`);
});
for (const [name, field, text, extra] of [
  ['F1-4 letter credentials and title', 'letter.proof2', "I hold a master's degree in economics and served as vice president of operations."],
  ['F1-4 letter ownership and bound units', 'letter.proof2', 'At RouteLab I led 620 analysts and saved $2.4M in costs.'],
  ['F1-1 COO does not match Coordinator', 'statement', 'Founder and COO who supported route planning and built reports for dispatch teams.'],
  ['F1-1 US does not match using', 'statement', 'Analyst with US and DATA experience who supported route planning and built reports for dispatch teams.'],
  ['F1-10 names-only benefits under What we offer', 'letter.hook', 'I value the Meta wellness rewards you offer.', { jdText: `${jdText.split('Salary:')[0]}What we offer:\nMeta wellness rewards.` }],
  ['F1-10 names-only benefits under Benefits', 'letter.hook', 'I value the Meta wellness rewards you offer.', { jdText: `${jdText.split('Salary:')[0]}Benefits:\nMeta wellness rewards.` }],
]) test(name, () => {
  const v = response();
  const [root, beat] = field.split('.');
  if (beat) v[root][beat] += ` ${text}`; else v[root] = text;
  const c = check(v, extra);
  const final = beat ? c.draft[root][beat] : c.draft[root];
  assert.ok(!final.includes(text), 'false sentence must be dropped');
  const expected = name.includes('credentials') ? 'credentials' : name.includes('ownership') ? 'ownership' : 'names';
  assert.ok(c.notes.some(n => n.field === field && n.action === 'drop' && n.check === expected));
});

for (const [role, bullet, text] of [
  [0, 1, 'Cut missed windows from 9.1% to 4.3% for 620 vans.'],
  [0, 0, 'Helped with planning for 20+ accounts using Postgres.'],
  [1, 0, 'Weekly readouts served 14 dispatch leads and 40 stores.'],
  [3, 0, 'Scheduling tools reached 80 drivers using Kafka.'],
]) test(`F1-5 honest rewrite survives: ${text}`, () => {
  const v = response(); v.roles[role].bullets[bullet].text = text;
  const c = check(v);
  assert.equal(c.draft.bullets.find(b => b.claimId === ledger.claims.find(claim => claim.text === response().roles[role].bullets[bullet].text).id)?.text, text);
});
test('F1-5 honest When and This ask survives', () => {
  const v = response(); v.letter.ask = 'When could we review a route together? This would start with your dispatch team and compare the forecast with a field report before proposing the next step.';
  assert.equal(check(v).draft.letter.ask, v.letter.ask);
});
test('F1-1 all-caps names are case sensitive and Unicode word bounded', () => {
  const v = response(); v.statement = 'US route tools.';
  assert.equal(check(v, { resumeText: `${resumeText}\nus route tools\nÉUSÉ` }).draft.statement, '');
  assert.equal(check(v, { resumeText: `${resumeText}\nUS route tools` }).draft.statement, v.statement);
});
test('F1-2 number words, joined forms and legal same-unit rewrites', () => {
  assert.deepEqual(parseLeanNumbers('one, twenty-one, ninety, hundred, thousand, million, a dozen, double, doubling, tripled, 15yrs, 10x').map(n => n.token), ['one', 'twenty-one', 'ninety', 'hundred', 'thousand', 'million', 'a dozen', 'double', 'doubling', 'tripled', '15yrs', '10x']);
  for (const text of ['Supported fifty enterprise clients.', 'Supported doubling revenue.', 'Supported 10x revenue.']) {
    const v = response(); v.roles[0].bullets[0].text = text;
    assert.notEqual(check(v).draft.bullets[0].text, text);
  }
  const text = 'Supported fifty enterprise clients.';
  const l = structuredClone(ledger); l.claims[0].text = text;
  const v = response(); v.roles[0].bullets[0].text = text;
  assert.equal(check(v, { ledger: l, resumeText: `${resumeText}\n${text}` }).draft.bullets[0].text, text);
});
test('F1-3 ownership stems and credentials cannot be added to statements', () => {
  for (const word of ['leading', 'managing', 'owning', 'directing', 'heading', 'designing', 'creating', 'delivering', 'drove', 'launching', 'founding', 'spearheading', 'overseeing', 'director', 'VP', 'chief', 'manager of', 'MBA', 'PhD', 'certified', 'licensed']) {
    const v = response(); v.statement = `I am ${word} route planning.`;
    // Keep a valid resume shape while limiting evidence to supported/reduced work.
    v.roles = [v.roles[0]]; v.earlier = []; delete v.letter;
    const l = structuredClone(ledger); l.employers = [{ ...l.employers[0], roles: [l.employers[0].roles[0]] }]; l.claims = l.claims.slice(0, 2);
    const c = check(v, { feature: 'resume', resumeText: 'Jordan Rivera\n' + l.claims.map(c => c.text).join('\n'), ledger: l });
    assert.equal(c.draft.statement, '', word);
    assert.ok(c.notes.some(n => ['ownership', 'credentials', 'names'].includes(n.check)), word);
  }
});
test('F1-4 posting cannot supply ownership or credentials to company beats', () => {
  for (const field of ['hook', 'companyInsight']) {
    const v = response(); const text = "I led operations as director with an MBA."; v.letter[field] += ` ${text}`;
    const c = check(v, { jdText: `We led operations as director with an MBA.\n${jdText}` });
    assert.ok(!c.draft.letter[field].includes(text));
  }
});
test('F1-4 whole-resume numbers keep their own unit and order', () => {
  const v = response(); v.statement = 'I supported 620 analysts.';
  assert.equal(check(v).draft.statement, '');
  v.statement = 'I reduced missed windows from 4.3% to 9.1%.';
  assert.equal(check(v).draft.statement, '');
});
test('permitted skills-line Kafka remains supported (finding 12 is out of scope)', () => {
  const v = response(); v.roles[0].bullets[0].text = 'Supported planning for 21+ accounts using Kafka.';
  assert.equal(check(v).draft.bullets[0].text, v.roles[0].bullets[0].text);
});
test('F1-2 a number cannot borrow its unit from another resume line', () => {
  const v = response(); v.statement = 'I supported 620 analysts.';
  const c = check(v, { resumeText: `${resumeText}\n620\nanalysts` });
  assert.equal(c.draft.statement, '');
});
test('F1-2 rounded numbers retain provenance to their same-unit source', () => {
  const v = response(); v.roles[0].bullets[0].text = 'Supported planning for 20+ accounts using Postgres.';
  const c = check(v); const fact = c.provenance.find(p => p.claimId === 'claim-1').facts.find(f => f.token === '20+');
  assert.equal(fact.sourceId, 'claim-1'); assert.match(fact.source, /21\+ accounts/);
});
