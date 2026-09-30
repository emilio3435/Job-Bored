import { aliasesFor } from './materials-resume-structure.mjs';

/** @param {string} name */
const withoutSite = (name) => String(name || '').replace(/\s+[—–-]\s+[\w.-]+\.[a-z]{2,}(?=\s|$).*$/iu, '').replace(/\s+[—–]\s+.+$/u, '').replace(/\s+\([\w.-]+\.[a-z]{2,}\)\s*$/iu, '').trim();

/** @param {string} name */
export const employerAliases = (name) => aliasesFor(withoutSite(name));

/** @param {string} name */
export const employerKey = (name) => aliasesFor(withoutSite(name).replace(/\s*\((?:formerly|previously|now|fka|f\/k\/a|aka|a\.k\.a\.|acquired by|part of)\s+[^)]+\)/giu, ' '))[0] || '';

/** @param {unknown} value */
export function normalizeReadDate(value) {
  const text = String(value ?? '').trim();
  if (/^(present|current|now)$/iu.test(text)) return 'present';
  const year = /\b(?:19|20)\d{2}\b/u.exec(text)?.[0];
  if (!year || !/^(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+|(?:0?[1-9]|1[0-2])\/|(?:Spring|Summer|Fall|Autumn|Winter|Early|Mid|Late)\s+)?(?:19|20)\d{2}$/iu.test(text)) return null;
  const slash = /^(0?[1-9]|1[0-2])\//u.exec(text);
  if (slash) return `${year}-${slash[1].padStart(2, '0')}`;
  const month = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/iu.exec(text)?.[1].toLowerCase();
  if (!month) return year;
  /** @type {Record<string,string>} */
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12' };
  return `${year}-${months[month]}`;
}
