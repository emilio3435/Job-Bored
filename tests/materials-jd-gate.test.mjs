import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUsableJobDescription,
  resolveJobDescription,
} from "../server/materials-jd-gate.mjs";

const EAB_BLURB =
  "Low fit for Senior Director, Digital Marketing Strategy, Advancement — 4.7/10";

describe("isUsableJobDescription", () => {
  it("rejects the EAB fit blurb", () => {
    assert.equal(isUsableJobDescription(EAB_BLURB), false);
  });

  it("rejects short text", () => {
    assert.equal(isUsableJobDescription("A short note."), false);
  });

  it("accepts a real posting", () => {
    const jd = Array(90).fill("responsibility").join(" ");
    assert.equal(isUsableJobDescription(jd), true);
  });
});

describe("resolveJobDescription", () => {
  it("scrapes when cache is junk", async () => {
    const posting = Array(90).fill("requirement").join(" ");
    const result = await resolveJobDescription({
      cachedText: EAB_BLURB,
      jobUrl: "https://www.edtech.com/jobs/example",
      scrapeJob: async () => ({ description: posting }),
    });
    assert.equal(result.source, "scrape");
    assert.equal(isUsableJobDescription(result.text), true);
  });

  it("returns jd_unusable when scrape fails", async () => {
    const result = await resolveJobDescription({
      cachedText: EAB_BLURB,
      jobUrl: "https://www.edtech.com/jobs/example",
      scrapeJob: async () => {
        throw new Error("blocked");
      },
    });
    assert.equal(result.error, "jd_unusable");
  });
});
