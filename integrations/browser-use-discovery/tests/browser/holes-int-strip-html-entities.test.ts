import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripHtml, toPlainText } from "../../src/browser/selectors/shared.ts";

describe("HOLES integration · stripHtml numeric entities", () => {
  it("should drop out-of-range numeric entities instead of throwing", () => {
    assert.equal(stripHtml("Senior &#9999999; Engineer"), "Senior Engineer");
    assert.equal(stripHtml("Remote &#x110000; role"), "Remote role");
    assert.equal(toPlainText("<p>Data&#9999999;Lead</p>"), "DataLead");
  });

  it("should still decode valid numeric entities", () => {
    assert.equal(stripHtml("Caf&#233; &#x2014; Austin"), "Café — Austin");
  });
});
