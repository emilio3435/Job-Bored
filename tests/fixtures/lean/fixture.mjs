import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const resumeText = readFileSync(new URL('./resume.txt', import.meta.url), 'utf8').trim();
export const jdText = readFileSync(new URL('./posting.txt', import.meta.url), 'utf8').trim();
export const employers = [
  { id: 'north', name: 'Northwind', title: 'Operations Analyst', start: '2017-09', end: '2026', location: 'Little Rock', roles: [
    { id: 'north-r1', title: 'Operations Analyst', start: '2022', end: '2026' },
    { id: 'north-r2', title: 'Dispatch Analyst', start: '2020', end: '2022' },
    { id: 'north-r3', title: 'Field Analyst', start: '2017-09', end: '2020' },
  ] },
  { id: 'route', name: 'RouteLab', title: 'Founder', start: '2024', end: null, roles: [{ id: 'route-r1', title: 'Founder', start: '2024', end: null }] },
  { id: 'harbor', name: 'Harbor Works', title: 'Coordinator', start: '2014', end: '2017', roles: [{ id: 'harbor-r1', title: 'Coordinator', start: '2014', end: '2017' }] },
];
const texts = [
  ['north-r1', 'Supported planning for 21+ accounts using Postgres.'],
  ['north-r1', 'Reduced missed windows from 9.1% to 4.3% for 620 vans.'],
  ['north-r2', 'Ran weekly readouts for 14 dispatch leads and 40 stores.'],
  ['north-r2', 'Built a route forecast that saved $2.4M in costs.'],
  ['north-r3', 'Reviewed 130% growth across 60% of routes.'],
  ['north-r3', 'Ranked top-3 among 19 analysts in 2019.'],
  ['route-r1', 'Shipped a scheduling tool for 80 drivers using Kafka.'],
  ['route-r1', 'Built reports for 8–10 clients using Postgres.'],
  ['harbor-r1', 'Supported field reports for 12 clients.'],
];
export const claims = texts.map(([roleId, text], i) => ({ id: `claim-${i + 1}`, roleId, employerId: roleId.split('-r')[0], text, kind: 'achievement', verified: true, sourceRefs: ['resume-fixture'], metrics: [] }));
export const ledger = { contract: 'materials.ledger.v1', ledgerHash: 'sha256:1234', employers, claims: [...claims,
  { id: 'role-only', employerId: 'north', roleId: 'north-r1', kind: 'role', text: 'Operations Analyst', sourceRefs: ['resume-fixture'] },
  { id: 'profile-only', employerId: 'north', roleId: 'north-r1', kind: 'achievement', text: 'Profile only claim', sourceRefs: ['profile'] },
], sources: [{ id: 'resume-fixture', kind: 'resume' }], resumeStructure: { source: 'model', employers: [{ name: 'Northwind', aliases: ['northwind'], aliasClause: 'formerly Entercom' }] } };
export const resumeRead = { version: 2, textSha256: createHash('sha256').update(resumeText).digest('hex'), education: ['State College — BA Economics'], certifications: ['Data Certificate'], skills: { tools: ['Postgres', 'Kafka'], hard: [], soft: [] } };
export const letter = {
  hook: 'I build route tools for the people who use them. Harbor Fleet coordinates regional delivery routes, and that daily dispatch work connects to the reports I supported at Northwind. I would bring the same care to understanding how your team plans a route.',
  companyInsight: 'Your posting asks for route forecasts and better delivery reliability.',
  proof1: 'At Northwind I supported planning for 21+ accounts using Postgres. I reduced missed windows from 9.1% to 4.3% for 620 vans and used those results to help the team review the next route plan.',
  proof2: 'At RouteLab I shipped a scheduling tool for 80 drivers using Kafka. I kept the work tied to the drivers and their daily schedule, so the reports could help with decisions they needed to make.',
  ask: 'Could we review one route together? I would start with your dispatch team and compare the forecast with a field report before proposing the next step.',
};
export function response() {
  return { needs: ['Route forecasts', 'Delivery reliability', 'Dispatch reporting'], statement: 'Field analyst who supported route planning and built reports for dispatch teams, with practical experience reviewing forecasts and helping drivers use scheduling tools during their daily work.',
    roles: [
      { roleId: 'north-r1', bullets: [{ text: claims[0].text, basedOn: 'A1' }, { text: claims[1].text, basedOn: 'A2' }] },
      { roleId: 'north-r2', bullets: [{ text: claims[2].text, basedOn: 'B1' }] },
      { roleId: 'north-r3', bullets: [{ text: claims[4].text, basedOn: 'C1' }] },
      { roleId: 'route-r1', bullets: [{ text: claims[6].text, basedOn: 'D1' }, { text: claims[7].text, basedOn: 'D2' }] },
    ], earlier: [{ roleId: 'harbor-r1', text: claims[8].text, basedOn: 'E1' }], skills: ['Postgres', 'Kafka'], letter: { ...letter } };
}
export const pin = { provider: 'gemini', model: 'gemini-flash-latest', resolvedModel: 'gemini-flash-latest', apiKey: 'fixture-key' };
export function provider(values = [response()]) {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    const value = values[Math.min(requests.length - 1, values.length - 1)];
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] }) };
  };
  return { requests, fetchImpl };
}
export async function fakeSession() {
  const { writeFile } = await import('node:fs/promises');
  return { measure: async () => ({ fits: true, scrollHeight: 1000, clientHeight: 1056, lastTextBottom: 900, limit: 1027, blockedRequests: 0 }),
    pdf: async (_html, path) => { await writeFile(path, '%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n'); return { path, pages: 1, blockedRequests: 0 }; },
    rasterize: async src => src, close: async () => {} };
}
