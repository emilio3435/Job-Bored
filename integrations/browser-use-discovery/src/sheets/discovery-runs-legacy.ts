/**
 * DiscoveryRuns legacy-tab migration (BEAUDIT D13).
 *
 * The first DiscoveryRuns header had 9 columns ("Leads Written", no "Leads
 * Updated"). Rewriting only the header put the new 10-column labels above
 * 9-cell rows, so every old row read "worker" as Leads Updated. This moves
 * each legacy row into the new layout (an empty Leads Updated at G) and writes
 * the new header in the same values batchUpdate.
 */
import { DISCOVERY_RUNS_HEADER_ROW, DISCOVERY_RUNS_SHEET_NAME } from "../contracts.ts";
import {
  batchUpdateSheetValues,
  columnIndexToLetter,
  getSheetValues,
  type FetchLike,
} from "./sheets-client.ts";

const LEGACY_WIDTH = 9;
const LEADS_UPDATED_INDEX = 6;

/** A 9-column header from before "Leads Updated" existed. */
export function isLegacyDiscoveryRunsHeader(header: unknown[]): boolean {
  const cells = header.map((cell) => String(cell ?? "").trim());
  if (cells.includes("Leads Updated")) return false;
  if (cells.length < LEGACY_WIDTH) return false;
  return (
    cells[0] === DISCOVERY_RUNS_HEADER_ROW[0] &&
    cells[4] === DISCOVERY_RUNS_HEADER_ROW[4] &&
    (cells[5] === "Leads Written" || cells[5] === "Leads New") &&
    cells[6] === "Source"
  );
}

export function legacyRunCellsToCurrent(cells: string[]): string[] {
  const padded = cells.slice(0, LEGACY_WIDTH);
  while (padded.length < LEGACY_WIDTH) padded.push("");
  return [
    ...padded.slice(0, LEADS_UPDATED_INDEX),
    "",
    ...padded.slice(LEADS_UPDATED_INDEX),
  ];
}

export async function migrateLegacyDiscoveryRunsTab(
  sheetId: string,
  token: string,
  fetchImpl: FetchLike,
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
    const migrated = rows.map((cells) =>
      cells.length > LEGACY_WIDTH ? cells.slice(0, width) : legacyRunCellsToCurrent(cells),
    );
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
