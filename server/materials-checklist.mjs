import { readQaVerdict } from "./materials-qa.mjs";
/**
 * The manual-apply checklist (Wave 2 addition).
 *
 * The retired Hermes pipeline wrote manual-apply-checklist.md; the v3
 * pipeline never did, so the dossier's checklist row was dead. This module
 * builds the checklist deterministically — no model call — from what the
 * application package already knows:
 *
 *   manifest.json         the job URL (the apply link), company, title
 *   resume.pdf / *.txt    which documents exist
 *   qa.resume.json,
 *   qa.letter.json        their verdicts (READY / REVIEW / FAIL)
 *   outreach note         when a later lane writes one (outreach.json / .md)
 *   jd-extract.json       the posting's stated disqualifiers (bars)
 *   profile.json          "Your details" completeness (email, phone, links)
 *   voice.md              what the user says about salary questions
 *   the request           the contact JobBored's enrichment knows
 *
 * It is stored as checklist.json in the application folder: the generated
 * items plus each item's done / doneAt, which PUT toggles. Regenerating
 * keeps every tick by item id, so a fresh draft updates the details (a
 * resume that went from FAIL to READY) without losing progress.
 */

import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { resolveApplicationDir } from "./application-materials.mjs";
import { readProfile } from "./user-profile.mjs";
import { readVoice } from "./profile-voice.mjs";

export const CHECKLIST_CONTRACT = "materials.checklist.v1";
const CHECKLIST_FILE = "checklist.json";
const ITEM_ID = /^[a-z][a-z0-9-]{0,31}$/;
const FOLLOW_UP_DAYS = 7;
const OUTREACH_FILES = ["outreach.json", "outreach-note.md", "outreach.md"];

/**
 * @typedef {object} ChecklistAction
 * @property {"open" | "download" | "preview" | "copy" | "draft" | "profile" | "stage"} kind
 * @property {string} [href] an http(s) link (open)
 * @property {string} [filename] a package file (download / preview)
 * @property {string} [doc] "resume" | "cover_letter"
 * @property {boolean | "held"} [gate] the run is Held: ask before download
 * @property {string} [text] text to copy
 * @property {string} [stage] pipeline stage (stage)
 * @property {string} label the button's words
 */

/**
 * @typedef {object} ChecklistItem
 * @property {string} id
 * @property {string} label
 * @property {string} detail
 * @property {boolean} done
 * @property {string | null} doneAt
 * @property {"warn" | ""} [tone] something needs attention before this step
 * @property {ChecklistAction} [action]
 */

/**
 * @typedef {object} ChecklistFacts
 * @property {string} company
 * @property {string} title
 * @property {string} jobUrl http(s) or ""
 * @property {{ resume: boolean, coverLetter: boolean }} docs
 * @property {{ resume?: { disposition: string | null, state?: string, runId?: string, reason?: string }, letter?: { disposition: string | null, state?: string, runId?: string, reason?: string } }} verdicts
 * @property {string} outreachText "" when no note exists
 * @property {string[]} bars the posting's stated disqualifiers
 * @property {string} contact the hiring contact's name, "" when unknown
 * @property {{ email: boolean, phone: boolean, links: string[] } | null} details null when no profile is saved
 * @property {string} salaryLine what the voice guide says about pay, "" when silent
 */

/** @param {unknown} url */
function safeHttp(url) {
  const s = typeof url === "string" ? url.trim() : "";
  return /^https?:\/\//i.test(s) ? s : "";
}

/**
 * @param {{ disposition: string | null, state?: string } | undefined} v
 */
function verdictWords(v) {
  if (v?.state === "not_rescored") return "Not rescored yet — Rescore it before you send it.";
  if (!v || !v.disposition) return "";
  if (v.disposition === "FAIL") return "It failed its quality check. Repair it or read it closely first.";
  if (v.disposition === "REVIEW") return "Quality check says review. Give it a read.";
  return "Passed its quality check.";
}

/**
 * @param {string} iso
 * @param {number} days
 */
function addDays(iso, days) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + days * 864e5);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * The checklist for one application, from its facts and the saved ticks.
 * Pure: the same facts and state always give the same items.
 *
 * @param {ChecklistFacts} facts
 * @param {Record<string, { done: boolean, doneAt: string | null }>} [state]
 * @returns {ChecklistItem[]}
 */
export function buildChecklistItems(facts, state = {}) {
  /** @type {Omit<ChecklistItem, "done" | "doneAt">[]} */
  const items = [];
  const company = facts.company || "the company";

  if (facts.docs.resume) {
    const resume = facts.verdicts.resume;
    const held = Object.values(facts.verdicts).find(v => v?.disposition === "FAIL" && (!resume?.runId || !v.runId || v.runId === resume.runId));
    items.push({
      id: "resume",
      label: "Download your tailored resume (PDF)",
      detail: held ? `Held — ${held.reason || "A document in this run fails checks. Repair it or read it closely before you send it."}` : verdictWords(resume) || "Your resume for this role is ready.",
      ...(held ? { tone: /** @type {const} */ ("warn") } : {}),
      action: { kind: "download", doc: "resume", filename: "resume.pdf", gate: held ? "held" : false, label: "Download" },
    });
  } else {
    items.push({
      id: "resume",
      label: "Draft your tailored resume",
      detail: "Nothing to send yet: draft the resume for this role first.",
      tone: "warn",
      action: { kind: "draft", doc: "resume", label: "Draft" },
    });
  }

  if (facts.docs.coverLetter) {
    const fail = facts.verdicts.letter?.disposition === "FAIL";
    items.push({
      id: "letter",
      label: "Review your cover letter",
      detail: verdictWords(facts.verdicts.letter) || "Read it once before you send it.",
      ...(fail ? { tone: /** @type {const} */ ("warn") } : {}),
      action: { kind: "preview", doc: "cover_letter", filename: "cover-letter.html", label: "Read it" },
    });
  } else {
    items.push({
      id: "letter",
      label: "Decide on a cover letter",
      detail: "Optional for most applications; draft one if the form asks.",
      action: { kind: "draft", doc: "cover_letter", label: "Draft" },
    });
  }

  if (facts.details && (!facts.details.email || !facts.details.phone)) {
    const missing = [!facts.details.email ? "email" : "", !facts.details.phone ? "phone" : ""].filter(Boolean);
    items.push({
      id: "details",
      label: "Finish your details",
      detail: `Your details have no ${missing.join(" or ")}; application forms ask for both.`,
      tone: "warn",
      action: { kind: "profile", label: "Open your details" },
    });
  }

  const links = facts.details ? facts.details.links : [];
  items.push({
    id: "links",
    label: "Check your portfolio and profile links",
    detail: links.length
      ? `Open each one: ${links.join(", ")}.`
      : "Make sure LinkedIn and any portfolio link open and match your resume.",
  });

  if (facts.bars.length) {
    items.push({
      id: "must-haves",
      label: "Confirm you meet what the posting requires",
      detail: facts.bars.slice(0, 3).join(" · "),
    });
  }

  items.push({
    id: "salary",
    label: "If the form asks about salary, hold it for the recruiter",
    detail: facts.salaryLine || "Leave it blank or write \"open to discuss\"; you talk numbers with a person, not a form.",
  });

  items.push({
    id: "submit",
    label: `Submit the application on ${company}'s site`,
    detail: facts.jobUrl ? "The posting opens in a new tab." : "No posting link is saved for this role.",
    ...(facts.jobUrl ? { action: { kind: /** @type {const} */ ("open"), href: facts.jobUrl, label: "Open posting" } } : {}),
  });

  items.push({
    id: "confirmation",
    label: "Save the confirmation",
    detail: "Keep the confirmation email or a screenshot of the thank-you page.",
  });

  items.push({
    id: "outreach",
    label: facts.contact ? `Send a short note to ${facts.contact}` : "Send a short note to the hiring manager",
    detail: facts.outreachText
      ? "Your outreach note is drafted; copy it into LinkedIn or email."
      : facts.contact
        ? "Two lines: the role you applied for and the one result that fits it best."
        : "Find the hiring manager on LinkedIn; two lines on the role and your best-fitting result.",
    ...(facts.outreachText ? { action: { kind: /** @type {const} */ ("copy"), text: facts.outreachText, label: "Copy note" } } : {}),
  });

  const submittedAt = state.submit && state.submit.done ? state.submit.doneAt : null;
  items.push({
    id: "follow-up",
    label: `Follow up in ${FOLLOW_UP_DAYS} days`,
    detail: submittedAt
      ? `Follow up on ${addDays(submittedAt, FOLLOW_UP_DAYS)} if you have not heard back.`
      : `${FOLLOW_UP_DAYS} days after you submit, a short check-in keeps you on their list.`,
  });

  items.push({
    id: "status",
    label: "Mark the role Applied in your pipeline",
    detail: "Moves the card and records the date in your sheet.",
    action: { kind: "stage", stage: "applied", label: "Mark Applied" },
  });

  return items.map((item) => {
    const saved = state[item.id];
    return { ...item, done: Boolean(saved && saved.done), doneAt: saved && saved.done ? saved.doneAt || null : null };
  });
}

/**
 * @param {string} path
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, unknown> | null} qa
 */
function verdictOf(qa) {
  const view = readQaVerdict(qa);
  return view ? { disposition: view.disposition, state: view.state, runId: view.runId, reason: view.reasons[0]?.text || "" } : undefined;
}

/** @param {string} dir */
async function readOutreach(dir) {
  for (const name of OUTREACH_FILES) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    try {
      const raw = await readFile(path, "utf8");
      if (name.endsWith(".json")) {
        const parsed = JSON.parse(raw);
        const text = parsed && (parsed.linkedin || parsed.text || parsed.email);
        const note = typeof text === "string" ? text : (text && typeof text.text === "string" ? text.text : "");
        if (note.trim()) return note.trim().slice(0, 2000);
      } else if (raw.trim()) {
        return raw.trim().slice(0, 2000);
      }
    } catch {
      /* next candidate */
    }
  }
  return "";
}

/** The voice guide's own line about pay, when it has one. */
async function salaryLineFromVoice() {
  try {
    const voice = await readVoice();
    if (!voice.exists) return "";
    const line = voice.text.split(/\r?\n/).map((l) => l.replace(/^[-*#>\s]+/, "").trim())
      .find((l) => /\b(salary|comp(ensation)?|pay|rate)\b/i.test(l) && l.length <= 220);
    return line ? `Your voice guide: "${line}"` : "";
  } catch {
    return "";
  }
}

/** "Your details" completeness from the saved profile, null when none. */
async function detailsFromProfile() {
  try {
    const saved = await readProfile();
    if (!saved.ok || !saved.profile || typeof saved.profile !== "object") return null;
    const identity = /** @type {Record<string, unknown>} */ (/** @type {Record<string, unknown>} */ (saved.profile).identity || {});
    const links = identity.links && typeof identity.links === "object" ? /** @type {Record<string, unknown>} */ (identity.links) : {};
    const list = ["linkedin", "website", "github"]
      .map((k) => (typeof links[k] === "string" ? String(links[k]).replace(/^https?:\/\//i, "") : ""))
      .filter(Boolean);
    return {
      email: typeof identity.email === "string" && identity.email.includes("@"),
      phone: typeof identity.phone === "string" && identity.phone.replace(/\D/g, "").length >= 7,
      links: list,
    };
  } catch {
    return null;
  }
}

/**
 * Everything the checklist is built from, read from the package on disk.
 * @param {string} dir
 * @param {{ contact?: string }} [context]
 * @returns {Promise<ChecklistFacts>}
 */
export async function readChecklistFacts(dir, context = {}) {
  const manifest = (await readJson(join(dir, "manifest.json"))) || {};
  const extract = await readJson(join(dir, "jd-extract.json"));
  const bars = extract && Array.isArray(extract.bars)
    ? extract.bars.map((b) => (b && typeof b === "object" ? String(/** @type {Record<string, unknown>} */ (b).text || "") : String(b || ""))).filter(Boolean)
    : [];
  const contact = typeof context.contact === "string" ? context.contact.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80) : "";
  return {
    company: typeof manifest.company === "string" ? manifest.company : "",
    title: typeof manifest.title === "string" ? manifest.title : "",
    jobUrl: safeHttp(manifest.job_url),
    docs: {
      resume: existsSync(join(dir, "resume.pdf")) || existsSync(join(dir, "resume.html")),
      coverLetter: existsSync(join(dir, "cover-letter.pdf")) || existsSync(join(dir, "cover-letter.html")),
    },
    verdicts: {
      resume: verdictOf(await readJson(join(dir, "qa.resume.json"))),
      letter: verdictOf(await readJson(join(dir, "qa.letter.json"))),
    },
    outreachText: await readOutreach(dir),
    bars,
    contact,
    details: await detailsFromProfile(),
    salaryLine: await salaryLineFromVoice(),
  };
}

/**
 * @param {string} dir
 * @returns {Promise<Record<string, { done: boolean, doneAt: string | null }>>}
 */
async function readState(dir) {
  const saved = await readJson(join(dir, CHECKLIST_FILE));
  /** @type {Record<string, { done: boolean, doneAt: string | null }>} */
  const state = {};
  const items = saved && Array.isArray(saved.items) ? saved.items : [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = /** @type {Record<string, unknown>} */ (raw);
    if (typeof item.id !== "string" || !ITEM_ID.test(item.id)) continue;
    state[item.id] = { done: item.done === true, doneAt: typeof item.doneAt === "string" ? item.doneAt : null };
  }
  return state;
}

/**
 * @param {string} dir
 * @param {Record<string, unknown>} value
 */
async function writeAtomic(dir, value) {
  const path = join(dir, CHECKLIST_FILE);
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * @param {string} slug
 * @param {ChecklistItem[]} items
 * @param {Date} now
 */
function envelope(slug, items, now) {
  const done = items.filter((i) => i.done).length;
  return { contract: CHECKLIST_CONTRACT, slug, updatedAt: now.toISOString(), progress: { done, total: items.length }, items };
}

/**
 * GET: build the checklist, keep every saved tick, store and return it.
 * @param {string} slug
 * @param {{ root?: string, contact?: string, now?: () => Date }} [options]
 */
export async function loadChecklist(slug, { root, contact, now = () => new Date() } = {}) {
  const dir = await resolveApplicationDir(slug, { root });
  const facts = await readChecklistFacts(dir, { contact });
  const items = buildChecklistItems(facts, await readState(dir));
  const out = envelope(slug, items, now());
  await writeAtomic(dir, out);
  return out;
}

/**
 * PUT: tick or untick one item. Unknown ids are a 400.
 * @param {string} slug
 * @param {unknown} id
 * @param {unknown} done
 * @param {{ root?: string, contact?: string, now?: () => Date }} [options]
 */
export async function setChecklistItem(slug, id, done, { root, contact, now = () => new Date() } = {}) {
  if (typeof id !== "string" || !ITEM_ID.test(id)) {
    throw Object.assign(new Error("Unknown checklist item"), { statusCode: 400, code: "unknown_item" });
  }
  if (typeof done !== "boolean") {
    throw Object.assign(new Error("done must be true or false"), { statusCode: 400, code: "invalid_done" });
  }
  const dir = await resolveApplicationDir(slug, { root });
  const facts = await readChecklistFacts(dir, { contact });
  const state = await readState(dir);
  if (!buildChecklistItems(facts, state).some((i) => i.id === id)) {
    throw Object.assign(new Error("Unknown checklist item"), { statusCode: 400, code: "unknown_item" });
  }
  const at = now();
  state[id] = { done, doneAt: done ? (state[id] && state[id].done && state[id].doneAt) || at.toISOString() : null };
  const items = buildChecklistItems(facts, state);
  const out = envelope(slug, items, at);
  await writeAtomic(dir, out);
  return out;
}
