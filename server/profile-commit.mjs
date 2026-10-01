/**
 * Onboarding's one explicit save (JOBQA).
 *
 *   POST /profile/commit        the staged resume, profile, voice guide and
 *                               resume read, written together or not at all
 *   GET  /profile/commit/state  { ok, exists, revision, accountHash }
 *   GET  /profile/resume        { ok, resumeText }: the canonical resume
 *
 * Until this commit, onboarding writes nothing canonical: the upload, the
 * AI read, "Your details", "Your voice" and the fit edits live in the
 * browser's wizard draft. This is the only place they reach disk.
 *
 * On this single-profile server it guarantees:
 *   - `create` refuses when any saved profile, resume or voice guide
 *     exists, so a fresh or demo browser never replaces a saved setup;
 *   - `replace` needs the sha256 of the resume this browser committed
 *     before (it must equal the saved resume.txt), the revision the wizard
 *     saw, and the account hash of the last commit when one was recorded;
 *   - a repeated commit id replays the recorded result without writing, and
 *     an id is recorded only after every write succeeded;
 *   - a failed write puts every file back as it was.
 *
 * Crash protocol. Before the first write, a journal holding the commit id
 * and the old files is written; the commit record (profile-commit.json) is
 * written last, after every file. Recovery (the next commit, or server
 * start) reads both:
 *   - the record names the journal's commit → the commit completed and only
 *     the journal's removal was lost: remove the journal, keep the files;
 *   - the journal is a rolled-back tombstone → remove it;
 *   - otherwise the commit never finished → put the old files back, then
 *     remove the journal.
 * So a replayed commit id always describes the files on disk.
 * The account and resume hashes are consistency checks the browser sends,
 * not authentication: any local caller can send them. Separate saved
 * profiles per account on one machine (multitenancy) is not provided here.
 */

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { CANONICAL_RESUME_FILE } from "./materials-resume-source.mjs";
import { migrateProfile } from "./profile-identity.mjs";
import { validateResumeSync, writeCanonicalResume } from "./profile-resume-sync.mjs";
import { resolveVoicePath, saveVoice, voiceProblem } from "./profile-voice.mjs";
import { RESUME_READ_FILE, RESUME_READ_VERSION, resumeTextSha256, saveResumeRead } from "./resume-read.mjs";
import { resolveProfilePath, validateProfile, writeProfileAtomic } from "./user-profile.mjs";

export const COMMIT_RECORD_FILE = "profile-commit.json";
export const COMMIT_JOURNAL_FILE = "profile-commit.journal.json";

const COMMIT_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * @typedef {object} CommitPaths
 * @property {string} profile
 * @property {string} resume
 * @property {string} read
 * @property {string} voice
 * @property {string} record
 * @property {string} journal
 */

/**
 * @typedef {object} CommitFiles the canonical files' text, null when missing
 * @property {string | null} profile
 * @property {string | null} resume
 * @property {string | null} voice
 * @property {string | null} read
 */

/**
 * @typedef {object} CommitWriters one writer per file, replaceable by tests
 * @property {(path: string, text: string) => Promise<unknown>} resume
 * @property {(path: string, profile: Record<string, unknown>) => Promise<unknown>} profile
 * @property {(path: string, text: string) => Promise<unknown>} voice
 * @property {(path: string, read: Record<string, unknown>) => Promise<unknown>} read
 */

/**
 * @typedef {Error & { status: number, reason: string, extra: Record<string, unknown> }} CommitError
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {number} status
 * @param {string} reason
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 * @returns {CommitError}
 */
function commitError(status, reason, message, extra = {}) {
  const err = /** @type {CommitError} */ (new Error(message));
  err.status = status;
  err.reason = reason;
  err.extra = extra;
  return err;
}

/** @param {unknown} err @returns {err is CommitError} */
export function isCommitError(err) {
  return err instanceof Error && typeof (/** @type {any} */ (err).status) === "number" &&
    typeof (/** @type {any} */ (err).reason) === "string";
}

/** @param {string} text */
function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** JSON with sorted keys, so the same payload always hashes the same. @param {unknown} value @returns {string} */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** The files one commit covers: beside profile.json, and the voice guide where drafting reads it. */
export function defaultCommitPaths() {
  const profile = resolveProfilePath();
  const dir = dirname(profile);
  return {
    profile,
    resume: join(dir, CANONICAL_RESUME_FILE),
    read: join(dir, RESUME_READ_FILE),
    voice: resolveVoicePath(),
    record: join(dir, COMMIT_RECORD_FILE),
    journal: join(dir, COMMIT_JOURNAL_FILE),
  };
}

/**
 * The file's text, or null when it does not exist — including under a
 * parent that is not a directory, where no file can exist. Any other read
 * error (permissions) is thrown: a journal that can't be checked is not
 * assumed away.
 * @param {string} path
 * @returns {Promise<string | null>}
 */
async function readOrNull(path) {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    const code = /** @type {{ code?: unknown }} */ (err).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

/** A symlinked file is written through its link, as the voice store does. @param {string} path */
async function writeTargetOf(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return await realpath(path);
  } catch {
    // Missing: write the path itself.
  }
  return path;
}

/** Temp file beside the target, then rename: a crash never leaves half a file. @param {string} path @param {string} text */
async function writeAtomic(path, text) {
  const target = await writeTargetOf(path);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, text, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Put one file back exactly as the snapshot had it (null: it did not exist). @param {string} path @param {string | null} original */
async function restoreFile(path, original) {
  if (original === null) {
    await rm(path, { force: true });
    return;
  }
  await writeAtomic(path, original);
}

/** @param {CommitFiles} files */
function hasSavedSetup(files) {
  return files.profile !== null || files.resume !== null || files.voice !== null;
}

/** A hash of the saved profile, resume and voice guide; "empty" when none exists. @param {CommitFiles} files */
export function revisionOf(files) {
  if (!hasSavedSetup(files)) return "empty";
  const hash = createHash("sha256");
  for (const key of /** @type {const} */ (["profile", "resume", "voice"])) {
    const text = files[key];
    hash.update(`${key}\0${text === null ? "\u0000missing" : text}\0`);
  }
  return hash.digest("hex").slice(0, 32);
}

/** The saved resume's key: the CR-free, trimmed text's sha256 (what the browser proves). @param {string} text */
function resumeKeyOf(text) {
  return resumeTextSha256(String(text || "").replace(/\r/g, "").trim());
}

/**
 * Check and normalize a commit body. Throws a 4xx CommitError; writes nothing.
 * @param {unknown} body
 */
function parseCommit(body) {
  const record = isRecord(body) ? body : {};
  const commitId = typeof record.commitId === "string" ? record.commitId : "";
  if (!COMMIT_ID_RE.test(commitId)) {
    throw commitError(400, "invalid_commit", "The save needs an id of 8 to 128 letters, digits, - or _.");
  }
  const mode = record.mode === "create" || record.mode === "replace" ? record.mode : null;
  if (!mode) throw commitError(400, "invalid_commit", 'The save mode must be "create" or "replace".');

  /* "Start from a template" / "Start blank": an explicit profile-only save.
   * It writes no resume and never reads or inherits a saved one. */
  const noResume = record.noResume === true;
  /** @type {string | null} */
  let resumeText = null;
  if (noResume) {
    if (typeof record.resumeText === "string" && record.resumeText.trim()) {
      throw commitError(400, "invalid_commit", "A save without a resume can't also send resume text.");
    }
    if (mode !== "create") {
      throw commitError(400, "invalid_commit", "A save without a resume can only create a new setup.");
    }
  } else {
    const resume = validateResumeSync({ resumeText: record.resumeText });
    if (!resume.ok) throw commitError(resume.status, resume.reason, resume.message);
    resumeText = resume.text;
  }

  if (!isRecord(record.profile)) {
    throw commitError(400, "invalid_profile", "Send the profile to save.", {
      errors: [{ message: "profile must be a JSON object" }],
    });
  }
  const profile = /** @type {Record<string, unknown>} */ (migrateProfile(record.profile));
  const validation = validateProfile(profile);
  if (!validation.ok) {
    throw commitError(400, "invalid_profile", "The profile doesn't match JobBored's profile format.", {
      errors: validation.errors,
    });
  }

  /** @type {string | null} */
  let voiceText = null;
  if (record.voice != null) {
    const text = isRecord(record.voice) ? record.voice.text : undefined;
    const problem = typeof text === "string" ? voiceProblem(text) : "empty";
    if (problem || typeof text !== "string") {
      throw commitError(problem === "too_large" ? 413 : 400, `voice_${problem || "empty"}`, "The voice guide can't be saved as it is.");
    }
    voiceText = text;
  }

  const accountHash = record.accountHash == null ? null : String(record.accountHash);
  if (accountHash !== null && !SHA256_HEX_RE.test(accountHash)) {
    throw commitError(400, "invalid_commit", "accountHash must be a sha256 hex digest.");
  }
  const proof = record.proof == null ? null : String(record.proof);
  if (mode === "replace" && (proof === null || !SHA256_HEX_RE.test(proof))) {
    throw commitError(400, "invalid_commit", "Replacing the saved setup needs the sha256 of the resume this browser saved.");
  }
  const baseRevision = typeof record.baseRevision === "string" ? record.baseRevision : null;
  /* The read is derived from the resume: keep it only when it describes this exact text. */
  const read =
    resumeText !== null &&
    isRecord(record.read) &&
    record.read.version === RESUME_READ_VERSION &&
    record.read.textSha256 === resumeKeyOf(resumeText)
      ? record.read
      : null;
  /* What the save writes, and for whom — not how it was asked for. A retry
   * of a save that already landed may come back as "replace" (the browser
   * now holds the resume it committed) with the same id; same id and same
   * content replays. Mode, proof and base are checks, not content. */
  const payloadSha256 = sha256(
    stableStringify({ noResume, resumeText, profile: record.profile, voice: voiceText, accountHash }),
  );
  return { commitId, mode, noResume, resumeText, profile, voiceText, accountHash, proof, baseRevision, read, payloadSha256 };
}

/**
 * @param {{
 *   paths?: CommitPaths,
 *   writers?: Partial<CommitWriters>,
 *   removeJournal?: (path: string) => Promise<unknown>,
 *   postCommit?: (committed: { profile: Record<string, unknown>, resumeText: string | null }) => Promise<unknown>,
 * }} [options] `paths` pins every file (tests, the JOBQA fixture); otherwise
 *   they resolve per call like the rest of the profile store. `writers` and
 *   `removeJournal` let tests inject a failing step. `postCommit` runs after
 *   a successful commit (production: the claim ledger and logo refresh),
 *   best-effort.
 */
export function createProfileCommitService(options = {}) {
  const pathsOf = () => options.paths || defaultCommitPaths();
  const removeJournal = options.removeJournal || ((/** @type {string} */ path) => rm(path, { force: true }));
  /** @type {CommitWriters} */
  const writers = {
    resume: (path, text) => writeCanonicalResume(text, { path }),
    profile: (path, profile) => writeProfileAtomic(profile, { path }),
    voice: (path, text) => saveVoice(text, { path }),
    read: async (path, read) => {
      if (!(await saveResumeRead(/** @type {any} */ (read), { path }))) throw new Error("resume read cache write failed");
    },
    ...options.writers,
  };

  /* One commit at a time: a double click's second request waits, then replays. */
  /** @type {Promise<unknown>} */
  let tail = Promise.resolve();
  /* Derived writes keep commit order without holding the canonical lock. */
  /** @type {Promise<unknown>} */
  let derivedTail = Promise.resolve();
  /** @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  function serialize(fn) {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** @param {CommitPaths} paths @returns {Promise<CommitFiles>} */
  async function currentFiles(paths) {
    const [profile, resume, voice, read] = await Promise.all([
      readOrNull(paths.profile),
      readOrNull(paths.resume),
      readOrNull(paths.voice),
      readOrNull(paths.read),
    ]);
    return { profile, resume, voice, read };
  }

  /** @param {CommitPaths} paths @returns {Promise<Record<string, unknown> | null>} */
  async function readRecord(paths) {
    const raw = await readOrNull(paths.record);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Every file back to the snapshot, in reverse write order; the first failure is rethrown. @param {CommitPaths} paths @param {Record<string, unknown>} files */
  async function restoreAll(paths, files) {
    /** @type {unknown} */
    let firstError = null;
    for (const key of /** @type {const} */ (["read", "voice", "profile", "resume"])) {
      try {
        await restoreFile(paths[key], typeof files[key] === "string" ? /** @type {string} */ (files[key]) : null);
      } catch (err) {
        firstError = firstError || err;
      }
    }
    if (firstError) throw firstError;
  }

  /**
   * Finish what an interrupted save left behind (see "Crash protocol").
   * @param {CommitPaths} paths
   * @returns {Promise<"none" | "cleaned" | "rolled_back">}
   */
  async function recoverUnlocked(paths) {
    const raw = await readOrNull(paths.journal);
    if (raw === null) return "none";
    /** @type {unknown} */
    let journal = null;
    try {
      journal = JSON.parse(raw);
    } catch {
      journal = null;
    }
    if (!isRecord(journal) || typeof journal.commitId !== "string") {
      throw commitError(500, "commit_journal_unreadable", "An interrupted save left a journal JobBored can't read, so no new save was made.");
    }
    const record = await readRecord(paths);
    if (journal.rolledBack === true || (record && record.commitId === journal.commitId)) {
      await removeJournal(paths.journal);
      return "cleaned";
    }
    if (!isRecord(journal.files)) {
      throw commitError(500, "commit_journal_unreadable", "An interrupted save left a journal JobBored can't read, so no new save was made.");
    }
    await restoreAll(paths, journal.files);
    await removeJournal(paths.journal);
    return "rolled_back";
  }

  /**
   * A rolled-back save's journal: remove it, or failing that mark it so a
   * later recovery never puts its old files back over newer saves.
   * @param {CommitPaths} paths
   * @param {string} commitId
   */
  async function retireJournal(paths, commitId) {
    try {
      await removeJournal(paths.journal);
    } catch {
      await writeAtomic(paths.journal, `${JSON.stringify({ schema: 1, commitId, rolledBack: true })}\n`).catch(() => {});
    }
  }

  async function state() {
    return serialize(async () => {
      const paths = pathsOf();
      await recoverUnlocked(paths);
      const files = await currentFiles(paths);
      const record = await readRecord(paths);
      return {
        exists: hasSavedSetup(files),
        revision: revisionOf(files),
        accountHash: record && typeof record.accountHash === "string" ? record.accountHash : null,
      };
    });
  }

  async function savedResume() {
    return serialize(async () => {
      const paths = pathsOf();
      await recoverUnlocked(paths);
      const raw = await readOrNull(paths.resume);
      return raw === null ? null : raw.replace(/\r/g, "").trim();
    });
  }

  /** @param {unknown} body */
  async function commit(body) {
    const input = parseCommit(body);
    const result = await serialize(async () => {
      const paths = pathsOf();
      await recoverUnlocked(paths);

      const record = await readRecord(paths);
      if (record && record.commitId === input.commitId) {
        if (record.payloadSha256 !== input.payloadSha256) {
          throw commitError(409, "commit_id_reused", "This save id was already used for different details. Reload, then confirm again.");
        }
        return { ok: true, replayed: true, commitId: input.commitId, mode: record.mode, revision: record.revision };
      }

      const files = await currentFiles(paths);
      const revision = revisionOf(files);
      if (input.mode === "create") {
        if (hasSavedSetup(files)) {
          throw commitError(409, "canonical_profile_exists", "This computer already has a saved JobBored profile, so nothing was saved.", { revision });
        }
      } else {
        if (files.resume === null || resumeKeyOf(files.resume) !== input.proof) {
          throw commitError(409, "replace_proof_mismatch", "The saved resume isn't the one this browser saved, so nothing was replaced.");
        }
        if (input.baseRevision !== revision) {
          throw commitError(409, "profile_commit_stale", "Your saved setup changed since this page loaded. Reload, then confirm again.", { revision });
        }
        const recordedAccount = record && typeof record.accountHash === "string" ? record.accountHash : null;
        if (recordedAccount && recordedAccount !== input.accountHash) {
          throw commitError(409, "account_mismatch", "The saved setup was confirmed under a different Google account, so nothing was replaced.");
        }
      }

      await writeAtomic(
        paths.journal,
        `${JSON.stringify({ schema: 1, commitId: input.commitId, startedAt: new Date().toISOString(), files })}\n`,
      );
      let step = "resume";
      let readSaved = false;
      /** @type {Record<string, unknown> | null} */
      let committedRecord = null;
      try {
        if (input.resumeText !== null) await writers.resume(paths.resume, input.resumeText);
        step = "profile";
        await writers.profile(paths.profile, input.profile);
        if (input.voiceText !== null) {
          step = "voice";
          await writers.voice(paths.voice, input.voiceText);
        }
        if (input.read) {
          /* Derived: an old read stays keyed to the old text, so a failed cache write is harmless. */
          try {
            await writers.read(paths.read, input.read);
            readSaved = true;
          } catch {
            readSaved = false;
          }
        }
        step = "record";
        const after = await currentFiles(paths);
        committedRecord = {
          schema: 1,
          commitId: input.commitId,
          payloadSha256: input.payloadSha256,
          mode: input.mode,
          revision: revisionOf(after),
          accountHash: input.accountHash,
          committedAt: new Date().toISOString(),
        };
        /* The commit point: written last, atomically. From here on the save stands. */
        await writeAtomic(paths.record, `${JSON.stringify(committedRecord, null, 2)}\n`);
      } catch {
        let restored = false;
        try {
          await restoreAll(paths, files);
          restored = true;
        } catch {
          restored = false;
        }
        if (!restored) {
          /* The journal stays as it is: the next recovery restores the rest. */
          throw commitError(500, "commit_rollback_incomplete", "Saving failed and JobBored couldn't put every file back yet. It finishes the next time you save or restart JobBored.", { step });
        }
        await retireJournal(paths, input.commitId);
        throw commitError(500, "commit_failed_rolled_back", "Saving failed, and everything was put back as it was.", { step });
      }
      /* Housekeeping only: if removal fails, recovery sees the matching record and just removes it. */
      const journalCleared = await removeJournal(paths.journal).then(
        () => true,
        () => false,
      );

      return {
        ok: true,
        replayed: false,
        commitId: input.commitId,
        mode: input.mode,
        revision: committedRecord ? committedRecord.revision : null,
        readSaved,
        journalCleared,
      };
    });
    if (result.replayed) return result;
    /** @type {unknown} */
    let derived = null;
    if (options.postCommit) {
      const hook = options.postCommit;
      const run = derivedTail.then(() => hook({ profile: input.profile, resumeText: input.resumeText }));
      derivedTail = run.catch(() => undefined);
      try {
        derived = await run;
      } catch {
        derived = { ok: false };
      }
    }
    return { ...result, derived };
  }

  /**
   * Run an editor's save (Settings' profile, contact, resume, voice guide)
   * outside any commit: it waits for a running commit or rollback to end,
   * and finishes an interrupted one first, so a rollback can never undo the
   * editor's save. Fails closed: while an interrupted save can't be
   * finished (an unreadable journal, a restore that fails), the editor's
   * save is refused rather than written where a later recovery would undo it.
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function exclusive(fn) {
    return serialize(async () => {
      try {
        await recoverUnlocked(pathsOf());
      } catch {
        throw commitError(
          503,
          "profile_recovery_pending",
          "An interrupted save hasn't been finished yet, so this wasn't saved. Restart JobBored and try again.",
        );
      }
      return fn();
    });
  }

  return {
    state,
    savedResume,
    commit,
    exclusive,
    /** Finish a rollback an interrupted save left behind (server start). */
    recover: () => serialize(() => recoverUnlocked(pathsOf())),
  };
}

/**
 * Wrap an editor's save handler (POST /profile, POST /profile/contact,
 * PUT /profile/resume, PUT and DELETE /profile/voice) so it runs inside the
 * commit barrier until the handler itself has finished — not merely until
 * the response closed, which a reload or an aborted request does while the
 * write is still running. A refused save (profile_recovery_pending) answers
 * with its reason and writes nothing.
 * @param {{ exclusive: <T>(fn: () => Promise<T>) => Promise<T> }} service
 */
export function commitBarrier(service) {
  /**
   * @param {(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => unknown} handler
   */
  return function guard(handler) {
    /**
     * @param {import("express").Request} req
     * @param {import("express").Response} res
     * @param {import("express").NextFunction} next
     */
    return function guardedSave(req, res, next) {
      return service
        .exclusive(() => Promise.resolve(handler(req, res, next)))
        .catch((err) => {
          if (res.headersSent) return undefined;
          if (isCommitError(err)) {
            return res.status(err.status).json({ ok: false, reason: err.reason, message: err.message });
          }
          return res.status(500).json({ ok: false, reason: "write_failed" });
        });
    };
  };
}

/**
 * @typedef {ReturnType<typeof createProfileCommitService>} ProfileCommitService
 */

/**
 * @param {{ get: (path: string, handler: (req: import("express").Request, res: import("express").Response) => unknown) => unknown, post: (path: string, handler: (req: import("express").Request, res: import("express").Response) => unknown) => unknown }} app
 * @param {ProfileCommitService} service
 */
export function mountProfileCommit(app, service) {
  app.get("/profile/resume", async (_req, res) => {
    try {
      return res.json({ ok: true, resumeText: await service.savedResume() });
    } catch {
      return res.status(500).json({ ok: false, reason: "read_failed", message: "JobBored's server couldn't read the saved resume." });
    }
  });
  app.get("/profile/commit/state", async (_req, res) => {
    try {
      return res.json({ ok: true, ...(await service.state()) });
    } catch {
      return res.status(500).json({ ok: false, reason: "read_failed", message: "JobBored's server couldn't read the saved profile." });
    }
  });
  app.post("/profile/commit", async (req, res) => {
    try {
      return res.json(await service.commit(req.body));
    } catch (err) {
      if (isCommitError(err)) {
        return res.status(err.status).json({ ok: false, reason: err.reason, message: err.message, ...err.extra });
      }
      /* Only reachable before the first write (reading the saved files or
       * writing the journal failed): every later failure is a CommitError. */
      return res.status(500).json({ ok: false, reason: "commit_failed", message: "JobBored's server couldn't start saving your setup. Try again." });
    }
  });
}
