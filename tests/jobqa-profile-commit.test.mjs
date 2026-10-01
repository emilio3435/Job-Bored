/**
 * JOBQA: onboarding's one explicit save (server/profile-commit.mjs).
 *
 * Every test runs on its own temp store through injected paths: HOME is
 * never changed and the real home is never read. People are synthetic
 * (tests/fixtures/jobqa-hermetic/profiles.mjs): Morgan Existing is the setup
 * already saved on the "computer", Alex Example is a fresh person.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { commitBarrier, createProfileCommitService, mountProfileCommit } from "../server/profile-commit.mjs";
import { resumeTextSha256 } from "../server/resume-read.mjs";
import { readProfile } from "../server/user-profile.mjs";
import { ALEX, MORGAN, accountHashOf, manifestOf, morganSavedProfile, seedStore, storePaths } from "./fixtures/jobqa-hermetic/profiles.mjs";

const temps = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function store(seed = "empty") {
  const dir = await mkdtemp(join(tmpdir(), "jobqa-commit-"));
  temps.push(dir);
  const paths = storePaths(join(dir, "store"));
  await seedStore(paths, seed);
  return { dir, paths };
}

/** A valid v1 profile for Alex, contact identity included. */
function alexProfile() {
  return {
    version: 1,
    identity: {
      targetRoles: ["Product Operations Analyst"],
      targetSeniority: "any",
      primaryNarrative: "Operations analyst who turns messy intake queues into dashboards teams actually use.",
      fullName: "Alex Example",
      email: ALEX.email,
      location: { city: "Austin", state: "TX" },
    },
    strengths: [{ name: "SQL", rank: 1 }],
    hardConstraints: { workMode: "any", salaryRequired: false, workAuth: "us_authorized" },
  };
}

function alexCommit(overrides = {}) {
  return {
    commitId: "jobqa-alex-0001",
    mode: "create",
    resumeText: ALEX.resumeText,
    profile: alexProfile(),
    voice: { text: "# Alex's voice\n\nPlain and warm.\n" },
    accountHash: accountHashOf(ALEX.email),
    ...overrides,
  };
}

const text = (path) => readFile(path, "utf8");

describe("LOCALFIX saved setup reads and derived work", () => {
  it("R2-1 commit state reports the server's local deployment flag and defaults closed", async () => {
    const { paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    const source = await readFile(new URL("../server/index.mjs", import.meta.url), "utf8");
    const start = source.indexOf("mountProfileCommit(app, profileCommit");
    const registration = source.slice(start, source.indexOf("\n", start));
    for (const requireAuth of [true, false]) {
      const routes = new Map();
      new Function("app", "profileCommit", "mountProfileCommit", "REQUIRE_API_AUTH", registration)(
        { get: (path, handler) => routes.set(path, handler), post() {} }, service, mountProfileCommit, requireAuth,
      );
      let answer;
      await routes.get("/profile/commit/state")({}, { json: (value) => { answer = value; } });
      assert.equal(answer.local, !requireAuth);
    }
    const routes = new Map();
    mountProfileCommit({ get: (path, handler) => routes.set(path, handler), post() {} }, service);
    let answer;
    await routes.get("/profile/commit/state")({}, { json: (value) => { answer = value; } });
    assert.equal(answer.local, false, "missing deployment context must never authorize legacy adoption");
  });

  it("W3 GET /profile returns the original profile after a paused write rolls back", async () => {
    const { paths } = await store("existing");
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let entered;
    const paused = new Promise((resolve) => { entered = resolve; });
    const service = createProfileCommitService({ paths, writers: {
      profile: async (path) => {
        const transient = morganSavedProfile();
        transient.identity.fullName = "Uncommitted Fiction";
        await writeFile(path, JSON.stringify(transient));
        entered(); await gate; throw new Error("fixture rollback");
      },
    } });
    // Execute the actual route registration without starting the server.
    const source = await readFile(new URL("../server/index.mjs", import.meta.url), "utf8");
    const registration = source.slice(source.indexOf('app.get("/profile",'), source.indexOf('app.post("/profile",'));
    let handler;
    new Function("app", "guardSave", "readProfile", "redactFsPaths", "errorMessage", registration)(
      { get: (_path, fn) => { handler = fn; } }, commitBarrier(service),
      () => readProfile({ path: paths.profile }), (value) => value, (err) => err.message,
    );
    const revision = (await service.state()).revision;
    const saving = service.commit({
      commitId: "localfix-profile-rollback", mode: "replace", resumeText: MORGAN.resumeText,
      profile: morganSavedProfile(), proof: resumeTextSha256(MORGAN.resumeText), baseRevision: revision,
      accountHash: accountHashOf(MORGAN.email),
    }).catch((err) => err);
    await paused;
    let answer;
    const res = { headersSent: false, status: () => res, json: (value) => { answer = value; } };
    const reading = handler({}, res);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(answer, undefined, "GET must wait rather than return the transient profile");
    } finally {
      release(); await saving; await reading;
    }
    assert.equal(answer.profile.identity.fullName, "Morgan Existing");
  });

  it("W3 exposes the recorded owner and canonical resume through read-only routes", async () => {
    const { paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    await service.commit(alexCommit());
    const routes = new Map();
    mountProfileCommit({ get: (path, handler) => routes.set(path, handler), post() {} }, service);
    const read = async (path) => {
      let result;
      await routes.get(path)({}, { json: (data) => { result = data; } });
      return result;
    };
    assert.equal((await read("/profile/commit/state")).accountHash, accountHashOf(ALEX.email));
    assert.equal((await read("/profile/resume")).resumeText, ALEX.resumeText);
  });

  it("W3 saved reads wait for a paused commit to roll back", async () => {
    const { paths } = await store("empty");
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let entered;
    const paused = new Promise((resolve) => { entered = resolve; });
    const service = createProfileCommitService({
      paths,
      writers: { profile: async () => { entered(); await gate; throw new Error("fixture write failure"); } },
    });
    const saving = service.commit(alexCommit()).catch((err) => err);
    await paused;
    let stateSettled = false;
    const state = service.state().then((value) => { stateSettled = true; return value; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(stateSettled, false, "a half-written resume must not count as a completed saved setup");
    } finally {
      release();
      await saving;
    }
    assert.deepEqual(await state, { exists: false, revision: "empty", accountHash: null });
    assert.equal(await service.savedResume(), null);
  });

  it("S3 derived work releases canonical serialization, stays ordered, and skips replays", async () => {
    const { paths } = await store("empty");
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const hooks = [];
    const service = createProfileCommitService({
      paths,
      postCommit: async ({ resumeText }) => {
        hooks.push(resumeText);
        if (hooks.length === 1) { entered(); await gate; }
        return { ok: true };
      },
    });
    const first = service.commit(alexCommit());
    await started;
    let replayed = false;
    const replay = service.commit(alexCommit()).then((value) => { replayed = value.replayed; return value; });
    let second;
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(replayed, true, "ledger work must not hold up canonical replay");
      const revision = (await service.state()).revision;
      second = service.commit(alexCommit({
        commitId: "jobqa-alex-0002", mode: "replace", baseRevision: revision,
        proof: resumeTextSha256(ALEX.resumeText), resumeText: `${ALEX.resumeText}\nNewer setup.`,
      }));
      await service.exclusive(async () => {});
      assert.match(await text(paths.resume), /Newer setup\./, "the newer canonical save lands while the older ledger is busy");
      assert.deepEqual(hooks, [ALEX.resumeText], "the newer derived hook waits its turn");
    } finally {
      release();
      await first;
      await replay;
      if (second) await second;
    }
    assert.deepEqual(hooks, [ALEX.resumeText, `${ALEX.resumeText}\nNewer setup.`]);
  });
});

describe("JOBQA commit: create", () => {
  it("should save resume, profile, voice and record together on an empty computer", async () => {
    const { paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    const result = await service.commit(alexCommit());
    assert.equal(result.ok, true);
    assert.equal(result.replayed, false);
    assert.match(await text(paths.resume), /Alex Example/);
    assert.equal(JSON.parse(await text(paths.profile)).identity.fullName, "Alex Example");
    assert.match(await text(paths.voice), /Alex's voice/);
    const record = JSON.parse(await text(paths.record));
    assert.equal(record.commitId, "jobqa-alex-0001");
    assert.equal(record.accountHash, accountHashOf(ALEX.email));
    assert.equal(existsSync(paths.journal), false, "no journal is left behind");
    assert.equal((await service.state()).exists, true);
  });

  it("should refuse a create on a computer that already has a saved setup, changing nothing", async () => {
    const { dir, paths } = await store("existing");
    const before = await manifestOf(join(dir, "store"));
    const service = createProfileCommitService({ paths });
    await assert.rejects(service.commit(alexCommit()), { reason: "canonical_profile_exists", status: 409 });
    assert.deepEqual(await manifestOf(join(dir, "store")), before, "Morgan's saved setup is byte-for-byte unchanged");
  });

  it("should save a template/blank setup profile-only, reading and writing no resume", async () => {
    const { paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    const result = await service.commit(alexCommit({ resumeText: undefined, noResume: true, voice: undefined }));
    assert.equal(result.ok, true);
    assert.equal(existsSync(paths.resume), false, "no resume is invented or inherited");
    assert.equal(JSON.parse(await text(paths.profile)).identity.fullName, "Alex Example");
  });

  it("should still refuse a profile-only create where a saved setup exists", async () => {
    const { dir, paths } = await store("existing");
    const before = await manifestOf(join(dir, "store"));
    const service = createProfileCommitService({ paths });
    await assert.rejects(
      service.commit(alexCommit({ resumeText: undefined, noResume: true })),
      { reason: "canonical_profile_exists" },
    );
    assert.deepEqual(await manifestOf(join(dir, "store")), before);
  });

  it("should refuse a profile-only save that is a replace or that carries resume text", async () => {
    const { paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    await assert.rejects(service.commit(alexCommit({ noResume: true })), { reason: "invalid_commit", status: 400 });
    await assert.rejects(
      service.commit(alexCommit({ resumeText: undefined, noResume: true, mode: "replace", proof: "0".repeat(64) })),
      { reason: "invalid_commit" },
    );
  });
});

describe("JOBQA commit: replace", () => {
  async function morganReplace(paths, overrides = {}) {
    const service = createProfileCommitService({ paths });
    const { revision } = await service.state();
    const body = {
      commitId: "jobqa-morgan-0002",
      mode: "replace",
      resumeText: `${MORGAN.resumeText}\nUpdated line.`,
      profile: morganSavedProfile(),
      accountHash: accountHashOf(MORGAN.email),
      proof: resumeTextSha256(MORGAN.resumeText.replace(/\r/g, "").trim()),
      baseRevision: revision,
      ...overrides,
    };
    return { service, body };
  }

  it("should replace the saved setup for the browser that proves it holds the saved resume", async () => {
    const { paths } = await store("existing");
    const { service, body } = await morganReplace(paths);
    const result = await service.commit(body);
    assert.equal(result.ok, true);
    assert.match(await text(paths.resume), /Updated line\./);
  });

  it("should refuse a replace without the saved resume's proof", async () => {
    const { dir, paths } = await store("existing");
    const before = await manifestOf(join(dir, "store"));
    const { service, body } = await morganReplace(paths, { proof: resumeTextSha256(ALEX.resumeText) });
    await assert.rejects(service.commit(body), { reason: "replace_proof_mismatch" });
    assert.deepEqual(await manifestOf(join(dir, "store")), before);
  });

  it("should refuse a stale replace after another save changed the setup", async () => {
    const { dir, paths } = await store("existing");
    const { service, body } = await morganReplace(paths, { baseRevision: "an-old-revision" });
    const before = await manifestOf(join(dir, "store"));
    await assert.rejects(service.commit(body), { reason: "profile_commit_stale", status: 409 });
    assert.deepEqual(await manifestOf(join(dir, "store")), before);
  });

  it("should refuse a replace under a different Google account than the recorded one", async () => {
    const { dir, paths } = await store("existing");
    const { service, body } = await morganReplace(paths, { accountHash: accountHashOf(ALEX.email) });
    const before = await manifestOf(join(dir, "store"));
    await assert.rejects(service.commit(body), { reason: "account_mismatch" });
    assert.deepEqual(await manifestOf(join(dir, "store")), before);
  });
});

describe("JOBQA commit: idempotent", () => {
  it("should replay a repeated commit id without writing again", async () => {
    const { dir, paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    await service.commit(alexCommit());
    const after = await manifestOf(join(dir, "store"));
    const again = await service.commit(alexCommit());
    assert.equal(again.ok, true);
    assert.equal(again.replayed, true);
    assert.deepEqual(await manifestOf(join(dir, "store")), after, "the double click wrote nothing");
  });

  it("should serialize two concurrent clicks into one save and one replay", async () => {
    const { paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    const [first, second] = await Promise.all([service.commit(alexCommit()), service.commit(alexCommit())]);
    assert.deepEqual([first.replayed, second.replayed].sort(), [false, true]);
  });

  it("should replay the same id and content even when the retry now asks for replace", async () => {
    // Fit's retry after a failed browser copy: the browser now holds the
    // resume it committed, so the same save comes back as a replace.
    const { dir, paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    await service.commit(alexCommit());
    const after = await manifestOf(join(dir, "store"));
    const retry = await service.commit(
      alexCommit({ mode: "replace", proof: resumeTextSha256(ALEX.resumeText), baseRevision: "whatever-it-saw" }),
    );
    assert.equal(retry.ok, true);
    assert.equal(retry.replayed, true, "same id, same content: a replay, not commit_id_reused");
    assert.deepEqual(await manifestOf(join(dir, "store")), after);
  });

  it("should refuse a used commit id sent with different details", async () => {
    const { paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    await service.commit(alexCommit());
    const changed = alexCommit({ profile: { ...alexProfile(), strengths: [{ name: "Looker", rank: 1 }] } });
    await assert.rejects(service.commit(changed), { reason: "commit_id_reused" });
  });
});

describe("JOBQA commit: all or nothing", () => {
  it("should put every file back when a later write fails, and record nothing", async () => {
    const { dir, paths } = await store("existing");
    const before = await manifestOf(join(dir, "store"));
    const service = createProfileCommitService({
      paths,
      writers: {
        voice: async () => {
          throw new Error("injected voice write failure");
        },
      },
    });
    const { revision } = await service.state();
    await assert.rejects(
      service.commit({
        commitId: "jobqa-morgan-fail",
        mode: "replace",
        resumeText: "Morgan Existing\nA different resume that must not survive.",
        profile: morganSavedProfile(),
        voice: { text: "# A new voice that must not survive\n" },
        accountHash: accountHashOf(MORGAN.email),
        proof: resumeTextSha256(MORGAN.resumeText),
        baseRevision: revision,
      }),
      { reason: "commit_failed_rolled_back", status: 500 },
    );
    const afterFiles = await manifestOf(join(dir, "store"));
    const kept = (m) => m.files.filter((f) => !/\.bak\./.test(f.path));
    assert.deepEqual(kept(afterFiles), kept(before), "resume, profile, voice and record are byte-for-byte the originals");
    assert.equal(existsSync(paths.journal), false);
  });
});

describe("JOBQA commit: crash protocol", () => {
  it("should keep a finished commit when a crash left its journal behind (crash after the record)", async () => {
    // Astra's reproduction: a successful create, then the pre-commit journal
    // recreated as crash residue; recovery must not roll the files back
    // under a record that says the commit happened.
    const { paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    await service.commit(alexCommit());
    await writeFile(
      paths.journal,
      JSON.stringify({ schema: 1, commitId: "jobqa-alex-0001", files: { profile: null, resume: null, voice: null, read: null } }),
    );
    assert.equal(await service.recover(), "cleaned");
    assert.equal(existsSync(paths.journal), false);
    assert.equal((await service.state()).exists, true, "the committed setup is still there");
    const again = await service.commit(alexCommit());
    assert.equal(again.replayed, true);
    assert.equal(JSON.parse(await text(paths.profile)).identity.fullName, "Alex Example", "the replay describes the files on disk");
  });

  it("should roll back a commit a crash interrupted before its record", async () => {
    const { dir, paths } = await store("existing");
    const before = await manifestOf(join(dir, "store"));
    const original = { profile: await text(paths.profile), resume: await text(paths.resume), voice: await text(paths.voice), read: null };
    await writeFile(paths.journal, JSON.stringify({ schema: 1, commitId: "jobqa-crashed", files: original }));
    await writeFile(paths.resume, "Half-written new resume\n");
    const service = createProfileCommitService({ paths });
    assert.equal(await service.recover(), "rolled_back");
    assert.equal(await text(paths.resume), original.resume);
    assert.deepEqual(await manifestOf(join(dir, "store")), before);
  });

  it("should report success when only the journal cleanup failed, and finish it later", async () => {
    const { paths } = await store("empty");
    let failCleanup = true;
    const service = createProfileCommitService({
      paths,
      removeJournal: async (path) => {
        if (failCleanup) throw new Error("injected cleanup failure");
        await rm(path, { force: true });
      },
    });
    const result = await service.commit(alexCommit());
    assert.equal(result.ok, true, "the save stands: the record is its commit point");
    assert.equal(result.journalCleared, false);
    failCleanup = false;
    assert.equal(await service.recover(), "cleaned");
    assert.equal(JSON.parse(await text(paths.profile)).identity.fullName, "Alex Example");
  });
});

describe("JOBQA commit: editor saves never interleave with it", () => {
  it("should not let a rollback undo an editor save that arrived mid-commit", async () => {
    const { paths } = await store("existing");
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const service = createProfileCommitService({
      paths,
      writers: {
        profile: async () => {
          await gate;
          throw new Error("injected profile write failure");
        },
      },
    });
    const { revision } = await service.state();
    const committing = service
      .commit({
        commitId: "jobqa-morgan-slow",
        mode: "replace",
        resumeText: "Morgan Existing\nResume from the failing commit.",
        profile: morganSavedProfile(),
        accountHash: accountHashOf(MORGAN.email),
        proof: resumeTextSha256(MORGAN.resumeText),
        baseRevision: revision,
      })
      .catch((err) => err);
    const editor = service.exclusive(() => writeFile(paths.resume, "Editor save from Settings\n"));
    release();
    const failure = await committing;
    assert.equal(failure.reason, "commit_failed_rolled_back");
    await editor;
    assert.equal(await text(paths.resume), "Editor save from Settings\n", "the editor's save ran after the rollback and stands");
  });

  it("should refuse an editor save while an interrupted save can't be finished, writing nothing", async () => {
    const { dir, paths } = await store("existing");
    await writeFile(paths.journal, "{ not json");
    const before = await manifestOf(join(dir, "store"));
    const service = createProfileCommitService({ paths });
    let ran = false;
    await assert.rejects(
      service.exclusive(async () => {
        ran = true;
      }),
      { reason: "profile_recovery_pending", status: 503 },
    );
    assert.equal(ran, false, "the editor's write never ran");
    assert.deepEqual(await manifestOf(join(dir, "store")), before, "nothing changed, and nothing claimed success");
  });

  it("should hold the barrier until an aborted, slow editor write finishes, not until the response closed", async () => {
    const { paths } = await store("empty");
    const service = createProfileCommitService({ paths });
    const guard = commitBarrier(service);
    const order = [];
    let finishWrite;
    const slow = new Promise((resolve) => {
      finishWrite = resolve;
    });
    const handler = guard(async () => {
      order.push("editor-start");
      await slow;
      await mkdir(join(paths.profile, ".."), { recursive: true });
      await writeFile(paths.resume, "Editor resume\n");
      order.push("editor-end");
    });
    const res = { headersSent: false, status: () => res, json: () => res };
    const running = handler({}, res, () => {});
    // The browser reloads: the response closes, but the write is still running.
    const committing = service.commit(alexCommit()).then(
      () => order.push("commit"),
      (err) => order.push(`commit-refused:${err.reason}`),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(order, ["editor-start"], "the commit waits while the editor's write runs");
    finishWrite();
    await running;
    await committing;
    assert.deepEqual(order.slice(0, 2), ["editor-start", "editor-end"]);
    assert.equal(order[2], "commit-refused:canonical_profile_exists", "the commit saw the editor's finished save");
  });
});
