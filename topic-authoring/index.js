import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SAFE_TOPIC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export class TopicRevisionConflictError extends Error {
  constructor(topicID, expectedRevision, actualRevision) {
    super(`Revision conflict for topic "${topicID}": expected ${expectedRevision}, found ${actualRevision}. Refresh and retry.`);
    this.name = "TopicRevisionConflictError";
    this.code = "REVISION_CONFLICT";
    this.topicID = topicID;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function assertTopicID(topicID) {
  if (!SAFE_TOPIC_ID.test(topicID)) throw new Error(`Invalid topic id "${topicID}".`);
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new Error(`Refusing to access path outside the knowledge root: ${resolvedTarget}`);
  }
}

async function assertRealInside(root, target) {
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(target);
  const relative = path.relative(realRoot, realTarget);
  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new Error(`Refusing to access real path outside the knowledge root: ${target}`);
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function revisionOf(topic) {
  const revision = topic.revision;
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function removeStaleLock(lockPath, staleMs) {
  let stats;
  try {
    stats = await fs.stat(lockPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (Date.now() - stats.mtimeMs <= staleMs) return;

  try {
    const owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
    if (Number.isInteger(owner.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
        return;
      } catch (error) {
        if (error.code !== "ESRCH") return;
      }
    }
  } catch {
    // An old malformed lock can be reclaimed after the stale threshold.
  }

  const stalePath = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
  try {
    await fs.rename(lockPath, stalePath);
    await fs.rm(stalePath, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function withTopicFileLock(knowledgeRoot, topicID, operation, options = {}) {
  assertTopicID(topicID);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleMs = options.staleMs ?? 120_000;
  const pollMs = options.pollMs ?? 25;
  const lockDirectory = path.join(knowledgeRoot, ".locks", "topics");
  const lockPath = path.join(lockDirectory, `${topicID}.lock`);
  assertInside(knowledgeRoot, lockPath);
  await fs.mkdir(lockDirectory, { recursive: true, mode: 0o700 });
  await assertRealInside(knowledgeRoot, lockDirectory);

  const token = randomUUID();
  const startedAt = Date.now();
  let acquired = false;
  while (!acquired) {
    let createdLock = false;
    let handle;
    try {
      handle = await fs.open(lockPath, "wx", 0o600);
      createdLock = true;
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, acquiredAt: new Date().toISOString() }) + "\n");
      await handle.close();
      handle = undefined;
      acquired = true;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (createdLock) await fs.rm(lockPath, { force: true }).catch(() => undefined);
      if (error.code !== "EEXIST") throw error;
      await removeStaleLock(lockPath, staleMs);
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for topic lock "${topicID}" after ${timeoutMs}ms.`);
      }
      await delay(pollMs);
    }
  }

  try {
    return await operation();
  } finally {
    try {
      const owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
      if (owner.token === token) await fs.unlink(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function atomicReplace(filePath, contents) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function mutateTopicJson(options) {
  const { knowledgeRoot, topicPath, topicID, expectedRevision, transform, validate } = options;
  assertTopicID(topicID);
  assertInside(knowledgeRoot, topicPath);
  await assertRealInside(knowledgeRoot, topicPath);

  return withTopicFileLock(knowledgeRoot, topicID, async () => {
    const original = await fs.readFile(topicPath, "utf8");
    let existing;
    try {
      existing = JSON.parse(original);
    } catch (error) {
      throw new Error(`Malformed JSON in ${topicID}.json: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(existing)) throw new Error(`Topic ${topicID}.json must contain an object.`);
    if (existing.id !== topicID) throw new Error(`Topic id "${String(existing.id)}" must match file slug "${topicID}".`);

    const previousRevision = revisionOf(existing);
    if (expectedRevision !== undefined && expectedRevision !== previousRevision) {
      throw new TopicRevisionConflictError(topicID, expectedRevision, previousRevision);
    }

    const transformed = await transform(existing);
    if (!isRecord(transformed)) throw new Error("Topic mutation must return an object.");
    const next = {
      ...transformed,
      id: topicID,
      schemaVersion: Math.max(typeof transformed.schemaVersion === "number" ? transformed.schemaVersion : 1, 2),
      revision: previousRevision + 1
    };
    const validated = await validate(next);
    const topicToWrite = validated === undefined ? next : validated;
    if (!isRecord(topicToWrite)) throw new Error("Topic validator must return an object when it returns a value.");
    if (topicToWrite.id !== topicID || revisionOf(topicToWrite) !== previousRevision + 1) {
      throw new Error("Topic validator cannot change the server-managed id or revision.");
    }

    const backupDirectory = path.join(knowledgeRoot, ".backups", "topics");
    assertInside(knowledgeRoot, backupDirectory);
    await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    await assertRealInside(knowledgeRoot, backupDirectory);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDirectory, `${path.basename(topicPath)}.${stamp}.${randomUUID()}.bak`);
    await fs.writeFile(backupPath, original, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await atomicReplace(topicPath, JSON.stringify(topicToWrite, null, 2) + "\n");

    return { topic: topicToWrite, topicPath, backupPath, previousRevision, revision: previousRevision + 1 };
  }, options.lock);
}
