// F18/H8 guard: the Hermes resume/cover-letter templates ship in the PUBLIC
// repo, so they must hold neutral example values — never the owner's name,
// contact details, employers, or site. Real values come from gitignored
// files (§0.2). The materials notifier must read its Telegram chat/thread
// from env, not hardcode them.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const repoRoot = join(import.meta.dirname, "..");
const hermes = join(repoRoot, "integrations", "hermes-job-hunt");

/* Owner tokens that must not appear in the scrubbed files. */
const OWNER_TOKENS = [
  "Emilio",
  "emiliong",
  "Nunez",
  "nunez",
  "Audacy",
  "audacy",
  "Entercom",
  "entercom",
  "emiliobuilds",
  "elioai",
  "hormiga",
  "Hormiga",
  "501.366",
  "gmail.com",
  "3800236296",
];

const TEXT_EXTENSIONS = new Set([".html", ".txt", ".json", ".md", ".py", ".svg", ".jsx", ".sh", ".plist"]);

function textFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      textFiles(path, out);
    } else if ([...TEXT_EXTENSIONS].some((ext) => name.endsWith(ext))) {
      out.push(path);
    }
  }
  return out;
}

describe("F18/H8: Hermes materials identity scrub", () => {
  const templateDirs = [
    join(hermes, "resume-template"),
    join(hermes, "cover-letter-template"),
  ];

  for (const dir of templateDirs) {
    it(`${dir.split("/").pop()}/ holds no owner identity in text files`, () => {
      const hits = [];
      for (const path of textFiles(dir)) {
        const body = readFileSync(path, "utf8");
        for (const token of OWNER_TOKENS) {
          if (body.includes(token)) hits.push(`${path.split("hermes-job-hunt/")[1]}: ${token}`);
        }
      }
      assert.deepEqual(hits, []);
    });

    it(`${dir.split("/").pop()}/ has no owner-named files`, () => {
      const hits = [];
      const walk = (d) => {
        for (const name of readdirSync(d)) {
          if (name.startsWith(".")) continue;
          if (/emilio|audacy|elio|hormiga/i.test(name)) hits.push(join(d, name));
          const path = join(d, name);
          if (statSync(path).isDirectory()) walk(path);
        }
      };
      walk(dir);
      assert.deepEqual(hits, []);
    });
  }

  it("resume.html is labelled as the neutral example ingest source", () => {
    const body = readFileSync(join(hermes, "resume-template", "resume.html"), "utf8");
    assert.match(body, /neutral example/i);
    assert.match(body, /Jordan Rivera/);
    assert.match(body, /example\.com/);
  });

  it("cover-letter.html carries the neutral example contact block", () => {
    const body = readFileSync(join(hermes, "cover-letter-template", "cover-letter.html"), "utf8");
    assert.match(body, /Jordan Rivera/);
    assert.match(body, /jordan\.rivera@example\.com/);
  });

  it("F19: the old templates fetch no CDN scripts", () => {
    for (const file of [
      join(hermes, "resume-template", "resume.html"),
      join(hermes, "cover-letter-template", "cover-letter.html"),
      join(hermes, "cover-letter-template", "resume.html"),
    ]) {
      const body = readFileSync(file, "utf8");
      assert.doesNotMatch(body, /unpkg\.com/, file);
      assert.doesNotMatch(body, /tweaks-root/, file);
    }
  });

  it("notifier.py reads chat/thread from env with no hardcoded ids", () => {
    const body = readFileSync(join(hermes, "scripts", "materials_watcher", "notifier.py"), "utf8");
    const code = body
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(code, /CHAT_ID\s*=\s*-?\d{4,}/);
    assert.doesNotMatch(code, /THREAD_ID\s*=\s*\d+/);
    assert.doesNotMatch(code, /3800236296/);
    assert.match(code, /os\.environ\.get\("MATERIALS_TELEGRAM_CHAT_ID"/);
    assert.match(code, /os\.environ\.get\("MATERIALS_TELEGRAM_THREAD_ID"/);
    assert.match(body, /MATERIALS_TELEGRAM_CHAT_ID=-1001234567890/);
  });

  it("watcher launch files use $HOME, not a hardcoded username", () => {
    for (const file of [
      join(hermes, "scripts", "materials_watcher", "com.jobbored.materials-watcher.plist"),
      join(hermes, "scripts", "materials_watcher", "install-launchd.sh"),
      join(hermes, "scripts", "materials_watcher", "README.md"),
      join(hermes, "scripts", "materials_watcher", "prompts", "draft-prompt.template.txt"),
    ]) {
      const body = readFileSync(file, "utf8");
      assert.doesNotMatch(body, /\/Users\/emiliong/, file);
      assert.doesNotMatch(body, /for Emilio/, file);
    }
  });
});
