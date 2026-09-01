import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(
  repoRoot,
  "integrations",
  "hermes-job-hunt",
  "approval-contract.v1.json",
);
const hermesRoot = join(repoRoot, "integrations", "hermes-job-hunt");

function read(rel) {
  return readFileSync(join(hermesRoot, rel), "utf8");
}

function loadContract() {
  assert.equal(
    existsSync(contractPath),
    true,
    "approval-contract.v1.json must exist (F3C-APPLY02-CONTRACT)",
  );
  const raw = JSON.parse(readFileSync(contractPath, "utf8"));
  assert.equal(typeof raw.version, "string");
  assert.ok(raw.gate1 && raw.gate2, "contract must define gate1 and gate2");
  return raw;
}

describe("F3C-APPLY02-CONTRACT — one versioned Gate 1 / send / poll contract", () => {
  it("docs, runtime, send, and poll agree on Gate 2 thread id (no 48 vs 314 split)", () => {
    const contract = loadContract();
    const threadId = Number(contract.gate2.threadId);
    const chatId = Number(contract.gate2.chatId);
    assert.equal(Number.isInteger(threadId), true);
    assert.equal(Number.isInteger(chatId), true);
    assert.equal(
      contract.gate2.target,
      `telegram:${chatId}:${threadId}`,
      "gate2.target must be telegram:<chatId>:<threadId>",
    );

    const sendSrc = read("scripts/gate2_telegram.py");
    const watcherSrc = read("scripts/gate2-status-watcher.py");
    const submitSrc = read("scripts/jhos_submit.py");
    const orchestratorSrc = read("scripts/apply-orchestrator.py");
    const specSrc = read("approval-guard-spec.md");
    const loaderSrc = read("scripts/approval_contract.py");

    assert.match(
      loaderSrc,
      /approval-contract\.v1\.json/,
      "runtime loader must read the versioned contract JSON",
    );
    assert.match(sendSrc, /from approval_contract import|import approval_contract/, "send must import the contract");
    assert.match(watcherSrc, /from approval_contract import|import approval_contract/, "poll/watcher must import the contract");
    assert.match(submitSrc, /from approval_contract import|import approval_contract/, "jhos_submit must import the contract");
    assert.match(
      orchestratorSrc,
      /from approval_contract import|import approval_contract|gate2_telegram/,
      "apply-orchestrator must consume the contract or the send helper that does",
    );

    const sendLiterals = [...sendSrc.matchAll(/THREAD_ID\s*=\s*([0-9]+)/g)].map((m) => Number(m[1]));
    const watcherLiterals = [...watcherSrc.matchAll(/TELEGRAM_THREAD_ID\s*=\s*([0-9]+)/g)].map((m) => Number(m[1]));
    const submitTargets = [...submitSrc.matchAll(/telegram:(-?[0-9]+):([0-9]+)/g)];

    for (const n of sendLiterals) {
      assert.equal(n, threadId, "send must not hardcode a competing Gate 2 thread");
    }
    for (const n of watcherLiterals) {
      assert.equal(n, threadId, "watcher must not hardcode a competing Gate 2 thread");
    }
    for (const match of submitTargets) {
      assert.equal(Number(match[1]), chatId, "jhos_submit chat must equal contract.gate2.chatId");
      assert.equal(Number(match[2]), threadId, "jhos_submit thread must equal contract.gate2.threadId");
    }

    const competing = threadId === 48 ? 314 : 48;
    assert.equal(
      sendSrc.includes(`THREAD_ID = ${competing}`) || sendSrc.includes(`thread ${competing}`),
      false,
      `send must not keep competing thread ${competing}`,
    );
    assert.equal(
      watcherSrc.includes(`TELEGRAM_THREAD_ID = ${competing}`) || watcherSrc.includes(`thread ${competing}`),
      false,
      `watcher must not keep competing thread ${competing}`,
    );
    assert.equal(
      submitSrc.includes(`telegram:${chatId}:${competing}`),
      false,
      `jhos_submit must not keep competing thread ${competing}`,
    );

    assert.match(
      specSrc,
      new RegExp(`telegram:-1003800236296:${threadId}|thread ${threadId}`),
      "approval-guard-spec.md must document the same Gate 2 thread as the contract",
    );
    assert.match(
      loaderSrc,
      /GATE2_THREAD_ID/,
      "loader must export GATE2_THREAD_ID for send/poll",
    );
  });

  it("Gate 1 is the schema Approval Status marker, not a second competing rule", () => {
    const contract = loadContract();
    assert.equal(contract.gate1.columnId, "approvalStatus");
    assert.equal(contract.gate1.letter, "X");
    assert.equal(contract.gate1.passValue, "Approved");
    assert.equal(contract.gate1.failClosed, true);

    const submitSrc = read("scripts/jhos_submit.py");
    const specSrc = read("approval-guard-spec.md");
    assert.match(
      submitSrc,
      /COL_APPROVAL|approvalStatus|Approval Status/,
      "jhos_submit Gate 1 must read Approval Status",
    );
    assert.match(
      submitSrc,
      /passValue|Approved/,
      "jhos_submit Gate 1 must pass on Approved",
    );
    assert.match(
      specSrc,
      /approval-contract\.v1\.json/,
      "approval-guard-spec.md must point at the versioned contract",
    );
    assert.doesNotMatch(
      specSrc,
      /Column X \(`?Approval Status`?\) was added in Phase 2 but added unnecessary friction/,
      "spec must not keep the competing 'Column X deprecated' Gate 1 rule",
    );
  });
});
