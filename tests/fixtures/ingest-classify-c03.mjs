// Exact fictional source lines from C03. All other candidates stay unsure so
// ledger/fit fixtures cannot hide work, malformed pointers or invented names.
const education = new Set([
  'Fictional State University • Bachelor of Arts • 2013 — 2017',
  'Example Community College • Certificate • 2011 — 2012',
]);

export function classifyC03Fixture({ userText }) {
  return { lines: [...userText.matchAll(/^C(\d+): (.*)$/gmu)].map(([, id, text]) => ({
    line: `C${id}`,
    kind: education.has(text) ? 'not_work' : 'unsure',
    reason: education.has(text) ? 'education' : null,
  })) };
}
