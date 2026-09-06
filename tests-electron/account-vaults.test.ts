import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { AccountVaults } from "../electron/account-vaults";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

it("separates two accounts, rejects signed-out access, and restores the correct local vault", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-accounts-"));
  roots.push(root);
  const bundled = path.join(root, "starter");
  await fs.mkdir(path.join(bundled, "topics"), { recursive: true });
  const vaults = new AccountVaults(root, {
    settingsPath: path.join(root, "settings.json"), bundledKnowledgeRoot: bundled,
    personalKnowledgeRoot: path.join(root, "legacy"), legacyProgressPath: path.join(root, "progress.json")
  });
  try {
    expect(() => vaults.requireActive(undefined)).toThrow(/sign in/i);
    const alice = vaults.activate("alice");
    alice.createTopic({ title: "Alice private note" });
    const bob = vaults.activate("bob");
    expect(bob.snapshot.topics).toHaveLength(0);
    expect(bob.snapshot.settings.progressPath).not.toBe(alice.snapshot.settings.progressPath);
    bob.createTopic({ title: "Bob private note" });
    expect(() => vaults.requireActive("alice")).toThrow();
    expect(vaults.activate("alice").snapshot.topics.map(topic => topic.title)).toEqual(["Alice private note"]);
    vaults.deactivate();
    expect(() => vaults.requireActive("alice")).toThrow();
    expect(vaults.activate("bob").snapshot.topics.map(topic => topic.title)).toEqual(["Bob private note"]);
  } finally { vaults.deactivate(); }
});

it("reserves the existing vault for its previously signed-in owner across restarts", async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-accounts-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "starter", "topics"), { recursive: true });
  await fs.writeFile(path.join(root, "supabase-session.json"), JSON.stringify({ user: { id: "alice" } }));
  const paths = { settingsPath: path.join(root, "settings.json"), bundledKnowledgeRoot: path.join(root, "starter"),
    personalKnowledgeRoot: path.join(root, "legacy"), legacyProgressPath: path.join(root, "progress.json"), isolatedAccount: true };
  let vaults = new AccountVaults(root, paths);
  try {
    vaults.activate("alice").createTopic({ title: "Original vault" });
    vaults.deactivate();
    await fs.writeFile(path.join(root, "supabase-session.json"), JSON.stringify({ user: { id: "bob" } }));
    vaults = new AccountVaults(root, paths);
    expect(vaults.activate("bob").snapshot.topics).toHaveLength(0);
    expect(vaults.activate("alice").snapshot.topics[0].title).toBe("Original vault");
  } finally { vaults.deactivate(); }
});
