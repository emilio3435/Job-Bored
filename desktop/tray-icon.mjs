/**
 * The menu-bar icon, drawn in code (a briefcase, 18 pt @2x) so the repo
 * carries no binary asset. Returned as raw BGRA for nativeImage.createFromBitmap;
 * macOS tints it as a template image.
 */

export const ICON_SIZE = 36;

/** @returns {Buffer} */
export function briefcaseBitmap() {
  const n = ICON_SIZE;
  const buf = Buffer.alloc(n * n * 4);
  /** @param {number} x @param {number} y */
  const on = (x, y) => {
    const i = (y * n + x) * 4;
    buf[i + 3] = 255; // alpha; black in BGR
  };
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const body = x >= 3 && x <= 32 && y >= 12 && y <= 31 && !((x === 3 || x === 32) && (y === 12 || y === 31));
      const clasp = x >= 15 && x <= 20 && y >= 19 && y <= 22;
      const handle =
        y >= 5 && y <= 11 && x >= 11 && x <= 24 && !(y >= 8 && x >= 14 && x <= 21);
      if ((body && !clasp) || handle) on(x, y);
    }
  }
  return buf;
}
