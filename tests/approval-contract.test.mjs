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
  it("docs, runtime, send, and poll share one Gate 2 route (no 48 vs 314 split)", () => {
    const contract = loadContract();
    // BEAUDIT H8/H21: owner routing ids live in the gitignored
    // approval-contract.local.json; the tracked contract ships none.
    assert.equal(contract.gate2.chatId, null, "tracked contract must not hold a chat id");
    assert.equal(contract.gate2.threadId, null, "tracked contract must not hold a thread id");
    assert.deepEqual(contract.gate2.approverUserIds, [], "tracked contract must not hold approver ids");
    assert.equal(contract.localOverride, "approval-contract.local.json");

    const example = JSON.parse(read("approval-contract.local.example.json"));
    assert.equal(Number.isInteger(example.gate2.chatId), true);
    assert.equal(Number.isInteger(example.gate2.threadId), true);
    assert.equal(Array.isArray(example.gate2.approverUserIds), true);
    assert.equal(Number.isInteger(example.interest.threadId), true);
    assert.notEqual(
      example.interest.threadId,
      example.gate2.threadId,
      "interest prompts and submit approvals use different threads",
    );

    const sendSrc = read("scripts/gate2_telegram.py");
    const watcherSrc = read("scripts/gate2-status-watcher.py");
    const submitSrc = read("scripts/jhos_submit.py");
    const orchestratorSrc = read("scripts/apply-orchestrator.py");
    const specSrc = read("approval-guard-spec.md");
    const loaderSrc = read("scripts/approval_contract.py");

    assert.match(loaderSrc, /approval-contract\.v1\.json/, "runtime loader must read the versioned contract JSON");
    assert.match(loaderSrc, /approval-contract\.local\.json/, "runtime loader must merge the local override");
    assert.match(sendSrc, /from approval_contract import|import approval_contract/, "send must import the contract");
    assert.match(watcherSrc, /from approval_contract import|import approval_contract/, "poll/watcher must import the contract");
    assert.match(submitSrc, /from approval_contract import|import approval_contract/, "jhos_submit must import the contract");
    assert.match(
      orchestratorSrc,
      /from approval_contract import|import approval_contract|gate2_telegram/,
      "apply-orchestrator must consume the contract or the send helper that does",
    );

    for (const [name, src] of [
      ["send", sendSrc],
      ["watcher", watcherSrc],
      ["jhos_submit", submitSrc],
    ]) {
      assert.equal(/THREAD_ID\s*=\s*[0-9]+/.test(src), false, `${name} must not hardcode a Gate 2 thread`);
      assert.equal(/CHAT_ID\s*=\s*-?[0-9]+/.test(src), false, `${name} must not hardcode a chat`);
      assert.equal(/telegram:-?[0-9]+:[0-9]+/.test(src), false, `${name} must not hardcode a telegram target`);
    }
    assert.equal(/TELEGRAM_HOME_CHANNEL/.test(watcherSrc), false, "the watcher must not let env override the contract chat");

    assert.match(specSrc, /telegram:<gate2\.chatId>:<gate2\.threadId>/, "spec must document the local Gate 2 target");
    assert.match(loaderSrc, /GATE2_THREAD_ID/, "loader must export GATE2_THREAD_ID for send/poll");
    assert.match(loaderSrc, /GATE2_APPROVER_USER_IDS/, "loader must export the approver allowlist");
    assert.match(loaderSrc, /INTEREST_THREAD_ID/, "loader must export the interest thread");
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
