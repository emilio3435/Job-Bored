/**
 * DiscoveryRuns legacy-tab migration (BEAUDIT D13).
 *
 * The first header had 9 columns (no Leads Updated); the next had 10 (no
 * Run ID). Preserve A–J values when adding K, and insert a blank G for the
 * nine-column layout before appending K.
 */
import { DISCOVERY_RUNS_HEADER_ROW, DISCOVERY_RUNS_SHEET_NAME } from "../contracts.ts";
import {
  batchUpdateSheetValues,
  columnIndexToLetter,
  getSheetValues,
  type FetchLike,
} from "./sheets-client.ts";

const LEGACY_WIDTH = 9;
const PRE_RUN_ID_WIDTH = 10;
const LEADS_UPDATED_INDEX = 6;

/** Either published header from before Run ID existed. */
export function isLegacyDiscoveryRunsHeader(header: unknown[]): boolean {
  const cells = header.map((cell) => String(cell ?? "").trim());
  if (cells.length < LEGACY_WIDTH) return false;
  const common = (
    cells[0] === DISCOVERY_RUNS_HEADER_ROW[0] &&
    cells[4] === DISCOVERY_RUNS_HEADER_ROW[4] &&
    (cells[5] === "Leads Written" || cells[5] === "Leads New")
  );
  return common && !cells.includes("Run ID") &&
    (cells[6] === "Source" ||
      (cells[6] === "Leads Updated" && cells[9] === "Error"));
}

export function legacyRunCellsToCurrent(cells: string[], nineColumnHeader = true): string[] {
  const padded = cells.slice(0, nineColumnHeader ? LEGACY_WIDTH : PRE_RUN_ID_WIDTH);
  while (padded.length < (nineColumnHeader ? LEGACY_WIDTH : PRE_RUN_ID_WIDTH)) padded.push("");
  const tenCells = nineColumnHeader
    ? [...padded.slice(0, LEADS_UPDATED_INDEX), "", ...padded.slice(LEADS_UPDATED_INDEX)]
    : padded;
  return [...tenCells, ""];
}

export async function migrateLegacyDiscoveryRunsTab(
  sheetId: string,
  token: string,
  fetchImpl: FetchLike,
  legacyHeader: unknown[] = [],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const width = DISCOVERY_RUNS_HEADER_ROW.length;
  const last = columnIndexToLetter(width);
  try {
    const rows = await getSheetValues(
      sheetId,
      `${DISCOVERY_RUNS_SHEET_NAME}!A2:${last}`,
      token,
      fetchImpl,
    );
    const nineColumnHeader = String(legacyHeader[6] || "").trim() === "Source";
    const migrated = rows.map((cells) => legacyRunCellsToCurrent(cells, nineColumnHeader));
    const data: Array<{ range: string; values: string[][] }> = [
      {
        range: `${DISCOVERY_RUNS_SHEET_NAME}!A1:${last}1`,
        values: [[...DISCOVERY_RUNS_HEADER_ROW]],
      },
    ];
    if (migrated.length) {
      data.push({
        range: `${DISCOVERY_RUNS_SHEET_NAME}!A2:${last}${migrated.length + 1}`,
        values: migrated.map((cells) => {
          const out = cells.slice(0, width);
          while (out.length < width) out.push("");
          return out;
        }),
      });
    }
    const response = await batchUpdateSheetValues(sheetId, data, token, fetchImpl);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, reason: `legacy header migration HTTP ${response.status}${detail ? ` - ${detail}` : ""}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `legacy header migration failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
