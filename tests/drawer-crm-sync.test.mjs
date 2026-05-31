import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(join(repoRoot, "app.js"), "utf8");
const sheetsWriteJs = readFileSync(join(repoRoot, "sheets-writeback.js"), "utf8");
const pipelineRenderJs = readFileSync(
  join(repoRoot, "pipeline-render.js"),
  "utf8",
);

/**
 * Extract a function body from app.js or pipeline-render.js source
 */
function extractFunctionBody(source, functionName) {
  // Match function definition - handle both function name() and async function name()
  const pattern = new RegExp(
    `(?:async\\s+)?function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`,
    "g",
  );
  const match = pattern.exec(source);
  if (!match) return null;

  let start = match.index + match[0].length;
  let braceCount = 1;
  let end = start;

  while (braceCount > 0 && end < source.length) {
    if (source[end] === "{") braceCount++;
    else if (source[end] === "}") braceCount--;
    end++;
  }

  return source.slice(start, end - 1);
}

function extractPipelineFunctionBody(functionName) {
  const body = extractFunctionBody(pipelineRenderJs, functionName);
  if (body !== null) return body;
  return extractFunctionBody(appJs, functionName);
}

/**
 * Check if a function body contains a call to refreshDrawerIfOpen
 */
function callsRefreshDrawer(body) {
  return body && body.includes("refreshDrawerIfOpen");
}

describe("Drawer CRM sync", () => {
  describe("updateJobNotes calls refreshDrawerIfOpen", () => {
    const body = extractFunctionBody(sheetsWriteJs, "updateJobNotes");
    it("updateJobNotes function exists", () => {
      assert.ok(body !== null, "updateJobNotes function should exist");
      assert.ok(
        extractFunctionBody(appJs, "updateJobNotes") !== null,
        "updateJobNotes wrapper should exist in app.js",
      );
    });
    it("calls refreshDrawerIfOpen after successful save", () => {
      assert.ok(
        callsRefreshDrawer(body),
        "updateJobNotes should call refreshDrawerIfOpen after saving",
      );
    });
  });

  describe("updateFollowUpDate calls refreshDrawerIfOpen", () => {
    const body = extractFunctionBody(sheetsWriteJs, "updateFollowUpDate");
    it("updateFollowUpDate function exists", () => {
      assert.ok(body !== null, "updateFollowUpDate function should exist");
      assert.ok(
        extractFunctionBody(appJs, "updateFollowUpDate") !== null,
        "updateFollowUpDate wrapper should exist in app.js",
      );
    });
    it("calls refreshDrawerIfOpen after successful save", () => {
      assert.ok(
        callsRefreshDrawer(body),
        "updateFollowUpDate should call refreshDrawerIfOpen after saving",
      );
    });
  });

  describe("updateLastHeardFrom calls refreshDrawerIfOpen", () => {
    const body = extractFunctionBody(sheetsWriteJs, "updateLastHeardFrom");
    it("updateLastHeardFrom function exists", () => {
      assert.ok(body !== null, "updateLastHeardFrom function should exist");
      assert.ok(
        extractFunctionBody(appJs, "updateLastHeardFrom") !== null,
        "updateLastHeardFrom wrapper should exist in app.js",
      );
    });
    it("calls refreshDrawerIfOpen after successful save", () => {
      assert.ok(
        callsRefreshDrawer(body),
        "updateLastHeardFrom should call refreshDrawerIfOpen after saving",
      );
    });
  });

  describe("updateJobResponseFlag calls refreshDrawerIfOpen", () => {
    const body = extractFunctionBody(sheetsWriteJs, "updateJobResponseFlag");
    it("updateJobResponseFlag function exists", () => {
      assert.ok(body !== null, "updateJobResponseFlag function should exist");
      assert.ok(
        extractFunctionBody(appJs, "updateJobResponseFlag") !== null,
        "updateJobResponseFlag wrapper should exist in app.js",
      );
    });
    it("calls refreshDrawerIfOpen after successful save", () => {
      assert.ok(
        callsRefreshDrawer(body),
        "updateJobResponseFlag should call refreshDrawerIfOpen after saving",
      );
    });
  });

  describe("status-select handler calls refreshDrawerIfOpen", () => {
    it("status-select change handler refreshes drawer after status change", () => {
      // The status-select handler is in attachCardListeners
      // It should call refreshDrawerIfOpen after updateJobStatus succeeds
      const handlerStart = pipelineRenderJs.indexOf(
        "// Pipeline stage select",
      );
      const handlerEnd = pipelineRenderJs.indexOf(
        "// Stage stepper clicks",
        handlerStart,
      );
      const statusSelectSection = pipelineRenderJs.slice(handlerStart, handlerEnd);

      assert.ok(
        statusSelectSection.includes("refreshDrawerIfOpen"),
        "status-select handler should call refreshDrawerIfOpen after status change",
      );
    });
  });

  describe("updateJobStatus emits the confirmed move event", () => {
    const body = extractFunctionBody(sheetsWriteJs, "updateJobStatus");
    const emitBody = extractFunctionBody(sheetsWriteJs, "emitPipelineMoveSucceeded");

    it("has a dedicated confirmed move event helper", () => {
      assert.ok(
        emitBody && emitBody.includes('"jb:write:succeeded"'),
        "status writes should emit the shared write-succeeded event",
      );
      assert.ok(
        emitBody && emitBody.includes('kind: "pipeline:move"'),
        "status writes should use the same pipeline move kind as kanban drag writes",
      );
    });

    it("captures the previous stage before local mutation", () => {
      assert.ok(
        body && body.includes("const prevStatus = job ? job.status : \"\";"),
        "updateJobStatus should keep the source stage before applying local status changes",
      );
    });

    it("emits after the Sheet update succeeds", () => {
      assert.ok(
        body && body.includes("emitPipelineMoveSucceeded(dataIndex, prevStatus, newStatus);"),
        "successful status-select and stage-step writes should notify downstream automation",
      );
    });
  });

  describe("refreshDrawerIfOpen function exists and is called", () => {
    const body = extractPipelineFunctionBody("refreshDrawerIfOpen");
    it("refreshDrawerIfOpen function exists", () => {
      assert.ok(
        body !== null,
        "refreshDrawerIfOpen function should exist",
      );
    });
    it("checks activeDetailKey matches dataIndex before refreshing", () => {
      assert.ok(
        body && body.includes("core().getActiveDetailKey() !== dataIndex"),
        "refreshDrawerIfOpen should guard against refreshing wrong job",
      );
    });
    it("attaches card listeners after refreshing content", () => {
      assert.ok(
        body && body.includes("attachCardListeners"),
        "refreshDrawerIfOpen should reattach card listeners after refresh",
      );
    });
  });

  describe("openJobDetail and closeJobDetail", () => {
    const openBody = extractPipelineFunctionBody("openJobDetail");
    const closeBody = extractPipelineFunctionBody("closeJobDetail");

    it("openJobDetail function exists", () => {
      assert.ok(openBody !== null, "openJobDetail function should exist");
    });
    it("closeJobDetail function exists", () => {
      assert.ok(closeBody !== null, "closeJobDetail function should exist");
    });
    it("openJobDetail sets activeDetailKey", () => {
      assert.ok(
        openBody && openBody.includes("core().setActiveDetailKey(stableKey)"),
        "openJobDetail should set activeDetailKey",
      );
    });
    it("closeJobDetail resets activeDetailKey to -1", () => {
      assert.ok(
        closeBody && closeBody.includes("core().setActiveDetailKey(-1)"),
        "closeJobDetail should reset activeDetailKey to -1",
      );
    });
    it("openJobDetail marks job as viewed", () => {
      assert.ok(
        openBody && openBody.includes("markJobViewed"),
        "openJobDetail should mark job as viewed",
      );
    });
  });
});
