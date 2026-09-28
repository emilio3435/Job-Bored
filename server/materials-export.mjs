/**
 * Materials exports beyond the PDF (Wave 2 · U-3): a Word document and
 * "Copy for LinkedIn" text, both built from the stored render model — the
 * same family-independent source the ATS .txt twins come from — so every
 * format says the same words.
 *
 * Word (.docx) is hand-rolled OOXML in a tiny zip writer instead of a
 * dependency. Why: the document needs five parts and three paragraph
 * styles; the `docx` package would add ~2 MB and a transitive tree to a
 * repo whose CI gates on `npm audit --omit=dev`, for features (tables,
 * images, numbering) an ATS-safe resume must not use anyway. Node 24 ships
 * zlib.crc32 and deflateRawSync, which is all a zip needs.
 */

import { deflateRawSync, crc32 } from "node:zlib";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveApplicationDir } from "./application-materials.mjs";
import { listRuns } from "./materials-history.mjs";
import { RUNS_DIR } from "./materials-package.mjs";
import { runsToText } from "./materials-render.mjs";

/** @typedef {import("./materials-render.mjs").RenderModel} RenderModel */
/** @typedef {import("./materials-render.mjs").Run} Run */
/** @typedef {"resume" | "cover_letter"} ExportDoc */

/**
 * @param {string} message
 * @param {number} statusCode
 * @param {string} [code]
 */
function httpError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

/* ---------------- zip (store + deflate, no data descriptors) ---------------- */

/**
 * @param {{ name: string, data: string | Buffer }[]} entries
 * @param {Date} [when]
 * @returns {Buffer}
 */
export function zipFiles(entries, when = new Date("2026-01-01T00:00:00Z")) {
  const dosTime = ((when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | Math.floor(when.getUTCSeconds() / 2)) & 0xffff;
  const dosDate = (((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate()) & 0xffff;
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const packed = deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); /* UTF-8 names */
    local.writeUInt16LE(8, 8); /* deflate */
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

/* ---------------- OOXML ---------------- */

/** @param {unknown} s */
function xml(s) {
  return String(s == null ? "" : s)
    /* Characters XML 1.0 cannot carry at all. */
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} text
 * @param {{ bold?: boolean }} [opts]
 */
function wRun(text, opts = {}) {
  if (!text) return "";
  return `<w:r>${opts.bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

/** @param {Run[] | string | undefined} runs */
function wRuns(runs) {
  if (typeof runs === "string") return wRun(runs);
  if (!Array.isArray(runs)) return "";
  return runs.map((r) => (r.n != null ? wRun(String(r.n), { bold: true }) : wRun(String(r.t ?? r.hl ?? "")))).join("");
}

/**
 * @param {string} body run xml
 * @param {string} [style]
 */
function wPara(body, style) {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${body}</w:p>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="220"/></w:pPr></w:style>
</w:styles>`;

/** @param {string} bodyXml */
function documentXml(bodyXml) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1008" w:right="1080" w:bottom="1008" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

/**
 * @param {string} bodyXml
 * @param {string} title
 */
function packageParts(bodyXml, title) {
  return [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title></cp:coreProperties>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "word/styles.xml", data: STYLES_XML },
    { name: "word/document.xml", data: documentXml(bodyXml) },
  ];
}

/** @param {RenderModel} model */
function headerParas(model) {
  const contact = (model.identity.contact || []).map((c) => c.text).filter(Boolean).join(" | ");
  return [
    wPara(wRun(model.identity.name), "Title"),
    model.identity.target ? wPara(wRun(model.identity.target)) : "",
    contact ? wPara(wRun(contact)) : "",
  ].join("");
}

/**
 * The resume as Word paragraphs: the same sections, order and words as
 * resume.txt, with metrics in bold.
 * @param {RenderModel} model
 */
export function resumeDocumentXml(model) {
  const resume = model.documents.resume;
  if (!resume) return "";
  /** @type {string[]} */
  const parts = [headerParas(model)];
  const statement = resume.statement && resume.statement.runs;
  if (runsToText(statement)) parts.push(wPara(wRun("Summary"), "Heading1"), wPara(wRuns(statement)));
  if (resume.intro && Array.isArray(resume.intro.runs)) {
    parts.push(wPara(wRun("Profile"), "Heading1"), wPara(wRuns(resume.intro.runs)));
  }
  for (const section of resume.sections || []) {
    if (section.kind === "readouts") continue;
    /** @type {string[]} */
    const body = [];
    for (const entry of section.entries || []) {
      const seat = runsToText(entry.seat);
      const meta = (entry.meta || []).filter(Boolean).join(" ");
      body.push(wPara(wRun([entry.org, seat].filter(Boolean).join(", "), { bold: true }) + (meta ? wRun(`  ${meta}`) : "")));
      const bullet = (/** @type {{ runs: Run[] }} */ b) => wPara(wRun("•\t") + wRuns(b.runs), "ListBullet");
      if (Array.isArray(entry.roles) && entry.roles.length) {
        for (const role of entry.roles) {
          const ids = new Set(role.claimIds || []);
          body.push(wPara(wRun([runsToText(role.seat), (role.meta || []).filter(Boolean).join(" ")].filter(Boolean).join(" | "))));
          for (const b of entry.bullets || []) if (ids.has(b.claimId)) body.push(bullet(b));
        }
      } else {
        for (const b of entry.bullets || []) body.push(bullet(b));
      }
      if (!(entry.bullets || []).length && entry.line) body.push(wPara(wRun(`•\t${entry.line}`), "ListBullet"));
    }
    for (const group of section.groups || []) body.push(wPara(wRun(`${group.label}: `, { bold: true }) + wRun(group.items.join(", "))));
    if (section.tokens && section.tokens.length) body.push(wPara(wRun(section.tokens.join(", "))));
    for (const line of section.lines || []) body.push(wPara(wRuns(line.runs)));
    if (body.length) parts.push(wPara(wRun(section.label), "Heading1"), ...body);
  }
  return parts.join("");
}

/**
 * @param {RenderModel} model
 */
export function letterDocumentXml(model) {
  const letter = model.documents.coverLetter;
  if (!letter) return "";
  /** @type {string[]} */
  const parts = [headerParas(model)];
  for (const group of letter.rail || []) {
    if (group.lines && group.lines.length) parts.push(wPara(wRun(`${group.label}: `, { bold: true }) + wRun(group.lines.join(", "))));
  }
  parts.push(wPara(wRun(letter.salutation || "")));
  for (const p of letter.paragraphs || []) parts.push(wPara(wRun(p.text)));
  parts.push(wPara(wRun(letter.signoff || "Best,")), wPara(wRun(model.identity.name)));
  return parts.join("");
}

/**
 * @param {RenderModel} model
 * @param {ExportDoc} doc
 * @returns {Buffer}
 */
export function buildDocx(model, doc) {
  const body = doc === "resume" ? resumeDocumentXml(model) : letterDocumentXml(model);
  if (!body) throw httpError(`This version has no ${doc === "resume" ? "resume" : "cover letter"} to export.`, 404, "doc_missing");
  const title = `${model.identity.name} — ${doc === "resume" ? "Resume" : "Cover letter"}`;
  return zipFiles(packageParts(body, title));
}

/**
 * LinkedIn's About and Experience fields as plain text, from the resume.
 * @param {RenderModel} model
 * @returns {{ about: string, experience: string, text: string }}
 */
export function linkedinText(model) {
  const resume = model.documents.resume;
  if (!resume) throw httpError("There is no resume to copy from yet.", 404, "doc_missing");
  const about = [runsToText(resume.statement && resume.statement.runs), resume.intro ? runsToText(resume.intro.runs) : ""]
    .filter(Boolean)
    .join("\n\n");
  /** @type {string[]} */
  const blocks = [];
  for (const section of resume.sections || []) {
    if (section.kind !== "experience" && section.kind !== "earlier") continue;
    for (const entry of section.entries || []) {
      /** @type {string[]} */
      const lines = [];
      const bullets = (/** @type {Set<string> | null} */ only) => (entry.bullets || [])
        .filter((b) => !only || only.has(b.claimId))
        .map((b) => `• ${runsToText(b.runs)}`);
      if (Array.isArray(entry.roles) && entry.roles.length) {
        for (const role of entry.roles) {
          lines.push(`${runsToText(role.seat)} · ${entry.org}`, (role.meta || []).filter(Boolean).join(" "));
          lines.push(...bullets(new Set(role.claimIds || [])), "");
        }
      } else {
        const seat = runsToText(entry.seat);
        lines.push(seat ? `${seat} · ${entry.org}` : entry.org);
        const meta = (entry.meta || []).filter(Boolean).join(" ");
        if (meta) lines.push(meta);
        lines.push(...bullets(null));
        if (!(entry.bullets || []).length && entry.line) lines.push(entry.line);
      }
      blocks.push(lines.filter((l, i, arr) => l !== "" || i < arr.length - 1).join("\n").trim());
    }
  }
  const experience = blocks.filter(Boolean).join("\n\n");
  const text = `ABOUT\n${about}\n\nEXPERIENCE\n${experience}\n`;
  return { about, experience, text };
}

/**
 * @param {string} path
 * @returns {Promise<RenderModel | null>}
 */
async function readModel(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && parsed.documents && parsed.identity ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The render model behind the version of `doc` the dashboard serves: the
 * run whose copy matches the top-level file, else the top-level model.
 * @param {string} slug
 * @param {ExportDoc} doc
 * @param {{ root?: string }} [options]
 * @returns {Promise<RenderModel>}
 */
export async function servedRenderModel(slug, doc, { root } = {}) {
  const appDir = await resolveApplicationDir(slug, { root });
  const key = doc === "resume" ? "resume" : "coverLetter";
  const { runs } = await listRuns(slug, { root });
  const active = runs.find((r) => r.active.includes(doc));
  if (active) {
    const model = await readModel(join(appDir, RUNS_DIR, active.runId, "render-model.json"));
    if (model && model.documents[key]) return model;
  }
  const top = await readModel(join(appDir, "render-model.json"));
  if (top && top.documents[key]) return top;
  throw httpError(`No ${doc === "resume" ? "resume" : "cover letter"} has been drafted for this role yet.`, 404, "doc_missing");
}

/** Filenames the export route answers, and what each one is. */
export const EXPORTS = /** @type {const} */ ({
  "resume.docx": { doc: "resume", kind: "docx" },
  "cover-letter.docx": { doc: "cover_letter", kind: "docx" },
  "linkedin.json": { doc: "resume", kind: "linkedin" },
});

/** @param {unknown} name @returns {name is keyof typeof EXPORTS} */
export function isExportName(name) {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(EXPORTS, name);
}

export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
