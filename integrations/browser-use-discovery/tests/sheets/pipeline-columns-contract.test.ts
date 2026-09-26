// BEAUDIT D19: bind every Pipeline column map to schemas/pipeline-row.v1.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { PIPELINE_HEADER_ROW } from "../../src/contracts.ts";
import { PIPELINE_COLUMNS } from "../../src/sheets/pipeline-columns.generated.ts";
import {
  PIPELINE_COL,
  PIPELINE_LAST_COLUMN_LETTER,
  pipelineLetter,
} from "../../src/sheets/sheets-client.ts";

const repoRoot = new URL("../../../../", import.meta.url);
const schema = JSON.parse(
  readFileSync(new URL("schemas/pipeline-row.v1.json", repoRoot), "utf8"),
) as {
  headerRow: string[];
  columns: Array<{ id: string; letter: string; headerLabel: string; sheetIndex: number; discoveryMerge: string }>;
};

test("D19: the worker PIPELINE_HEADER_ROW equals the schema headerRow", () => {
  assert.deepEqual([...PIPELINE_HEADER_ROW], schema.headerRow);
});

test("D19: the generated column map equals the schema columns", () => {
  assert.deepEqual(
    PIPELINE_COLUMNS.map((c) => ({ ...c })),
    schema.columns.map((c) => ({
      id: c.id,
      letter: c.letter,
      headerLabel: c.headerLabel,
      sheetIndex: c.sheetIndex,
      discoveryMerge: c.discoveryMerge,
    })),
  );
  for (const column of schema.columns) {
    assert.equal(PIPELINE_COL[column.id as keyof typeof PIPELINE_COL], column.sheetIndex, column.id);
    assert.equal(pipelineLetter(column.sheetIndex), column.letter, column.id);
  }
  assert.equal(PIPELINE_LAST_COLUMN_LETTER, schema.columns.at(-1)!.letter);
});

test("D19: every column declares a discovery merge rule", () => {
  const allowed = new Set(["overwrite", "lockable", "fillIfEmpty", "preserve"]);
  for (const column of schema.columns) {
    assert.ok(allowed.has(column.discoveryMerge), `${column.id}: ${column.discoveryMerge}`);
  }
  // The CRM columns are never written by re-discovery.
  for (const id of ["appliedDate", "notes", "followUpDate", "lastHeardFrom", "responseFlag", "editLock"]) {
    assert.equal(schema.columns.find((c) => c.id === id)!.discoveryMerge, "preserve", id);
  }
});

test("D19: the browser planner letters (pipeline-transitions.js) match the schema", () => {
  const source = readFileSync(new URL("pipeline-transitions.js", repoRoot), "utf8");
  const context: Record<string, unknown> = {};
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.runInNewContext(source, context);
  const api = (context.JobBoredPipelineTransitions ||
    (context as { window: Record<string, unknown> }).window.JobBoredPipelineTransitions) as
    | { COLUMNS?: Record<string, string> }
    | undefined;
  assert.ok(api?.COLUMNS, "pipeline-transitions.js must expose COLUMNS");
  const byId = new Map(schema.columns.map((c) => [c.id, c.letter]));
  const aliases: Record<string, string> = { lastContact: "lastHeardFrom" };
  for (const [key, letter] of Object.entries(api!.COLUMNS!)) {
    assert.equal(letter, byId.get(aliases[key] || key), key);
  }
});
