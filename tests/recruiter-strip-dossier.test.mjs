/**
 * UX-01 dossier half: recruiter CRM facts must be visible, escaped, and writable
 * through the full response enum instead of the legacy hardcoded-Yes chip.
 * Mutation check: dropping a field, interpolating raw HTML, or bypassing the
 * sheetsWrite bridge fails this probe.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "recruiter-strip.js");

function makeMount() {
  const listeners = new Map();
  const followUpInput = { value: "2026-09-12" };
  return {
    innerHTML: "",
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    querySelector(selector) {
      return selector === "[data-recruiter-follow-up]" ? followUpInput : null;
    },
    fire(type, action, value) {
      const target = {
        closest: () => target,
        getAttribute(name) {
          if (name === "data-action") return action;
          if (name === "data-value") return value;
          return null;
        },
      };
      listeners.get(type)?.({ target });
    },
  };
}

it("renders and delegates the dossier recruiter CRM row", () => {
  const replyWrites = [];
  const followUpWrites = [];
  const windowTarget = {
    JobBoredApp: {
      sheetsWrite: {
        updateFollowUpDate: (...args) => followUpWrites.push(args),
        updateJobResponseFlag: (...args) => replyWrites.push(args),
      },
    },
  };
  if (existsSync(sourcePath)) {
    vm.runInNewContext(readFileSync(sourcePath, "utf8"), {
      Object,
      String,
      window: windowTarget,
    }, { filename: "recruiter-strip.js" });
  }
  assert.ok(
    windowTarget.JobBoredRecruiterStrip,
    "UX-01: recruiter-strip.js must install its dossier renderer",
  );

  const mount = makeMount();
  windowTarget.JobBoredRecruiterStrip.render(mount, {
    job: {
      jobKey: "7",
      contact: "<Ana & Co>",
      lastHeardFrom: "2026-08-29",
      replied: "No",
      followUpDate: "2026-09-04",
    },
  });

  assert.match(mount.innerHTML, /brief__recruiter-strip/);
  assert.match(mount.innerHTML, /<jb-stage-dot/);
  assert.match(mount.innerHTML, /jb-sticker/);
  assert.match(mount.innerHTML, /&lt;Ana &amp; Co&gt;/);
  assert.doesNotMatch(mount.innerHTML, /<Ana & Co>/);
  assert.match(mount.innerHTML, /2026-08-29/);
  assert.match(mount.innerHTML, /2026-09-04/);
  for (const reply of ["Yes", "No", "Unknown"]) {
    assert.match(mount.innerHTML, new RegExp(`data-value="${reply}"`));
  }
  assert.match(mount.innerHTML, /aria-pressed="true"[^>]*>No</);
  assert.match(mount.innerHTML, /Next action/);

  mount.fire("click", "recruiter-reply", "Unknown");
  mount.fire("click", "recruiter-follow-up", null);
  assert.deepEqual(replyWrites, [["7", "Unknown"]]);
  assert.deepEqual(followUpWrites, [["7", "2026-09-12"]]);
});
