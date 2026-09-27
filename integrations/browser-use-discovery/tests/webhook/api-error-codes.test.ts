// W2SQ lane E: the worker's status-code map is the one exported home of its
// generic codes, and every value follows the lower_snake_case convention.
import assert from "node:assert/strict";
import test from "node:test";

import { STATUS_CODES, codeForStatus } from "../../src/webhook/api-error.ts";

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

test("worker STATUS_CODES values match the error-code convention", () => {
  assert.ok(STATUS_CODES && typeof STATUS_CODES === "object");
  for (const [status, code] of Object.entries(STATUS_CODES)) {
    assert.equal(typeof code, "string");
    assert.match(code as string, CODE_PATTERN, `STATUS_CODES[${status}]`);
  }
});

test("worker codeForStatus only emits conventional codes", () => {
  for (const status of [400, 401, 403, 404, 405, 409, 413, 421, 429, 418, 500, 502, 503, 504, 599]) {
    assert.match(codeForStatus(status), CODE_PATTERN, `status ${status}`);
  }
});
