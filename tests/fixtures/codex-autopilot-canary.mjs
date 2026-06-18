export function normalizeCanaryLabel(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, "-");
}
