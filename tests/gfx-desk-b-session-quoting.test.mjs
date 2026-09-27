// GFX DESK-B R18: the worker runs `browserUseCommand` through a shell
// (integrations/browser-use-discovery/src/browser/session.ts). A command that
// is a path under a HOME with a space must still run as one word, and the
// quoted line runtime-env builds for the desktop app must run as-is.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browserCommandShellLine,
  createBrowserUseSessionManager,
} from "../integrations/browser-use-discovery/src/browser/session.ts";
import { shellQuote } from "../scripts/lib/runtime-env.mjs";

const SCRIPT = `#!/bin/sh
cat > /dev/null
printf '{"url":"https://example.com/","text":"from-command"}'
`;
const NODE_SCRIPT = `process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(JSON.stringify({ url: "https://example.com/", text: "from-node" })));
`;

function manager(browserUseCommand) {
  return createBrowserUseSessionManager(
    { browserUseCommand },
    {
      fetchImpl: async () => {
        throw new Error("the command must run; no fetch fallback");
      },
    },
  );
}

const request = { url: "https://example.com/", instruction: "read", timeoutMs: 10_000 };

describe("GFX-DESK-B R18 browserUseCommand under a HOME with a space", () => {
  let root;
  let spacedDir;

  before(() => {
    root = mkdtempSync(join(tmpdir(), "gfx-desk-b-session-"));
    spacedDir = join(root, "Application Support", "it's here");
    mkdirSync(spacedDir, { recursive: true });
    writeFileSync(join(spacedDir, "browser cmd.sh"), SCRIPT);
    chmodSync(join(spacedDir, "browser cmd.sh"), 0o755);
    writeFileSync(join(spacedDir, "agent.mjs"), NODE_SCRIPT);
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  it("a bare path with spaces and a quote runs as one word", async () => {
    const result = await manager(join(spacedDir, "browser cmd.sh")).run(request);
    assert.equal(result.metadata.mode, "browser_use_command");
    assert.equal(result.text, "from-command");
  });

  it("runtime-env's quoted `'<node>' '<script>'` line runs unchanged", async () => {
    const line = `${shellQuote(process.execPath)} ${shellQuote(join(spacedDir, "agent.mjs"))}`;
    assert.equal(browserCommandShellLine(line), line);
    const result = await manager(line).run(request);
    assert.equal(result.text, "from-node");
  });

  it("Windows gets double quotes, which cmd.exe understands", () => {
    assert.equal(
      browserCommandShellLine("C:\\Users\\A B\\cmd.exe", () => true, "win32"),
      '"C:\\Users\\A B\\cmd.exe"',
    );
  });

  it("only an existing path is quoted; a command line is left to the user", () => {
    assert.equal(browserCommandShellLine("browser-use --headless"), "browser-use --headless");
    assert.equal(browserCommandShellLine(join(root, "missing file")), join(root, "missing file"));
    assert.equal(
      browserCommandShellLine(join(spacedDir, "browser cmd.sh")),
      `'${join(root, "Application Support", "it'\\''s here", "browser cmd.sh")}'`,
    );
  });
});
