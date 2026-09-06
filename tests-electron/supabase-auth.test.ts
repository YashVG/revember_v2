import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SupabaseAuth } from "../electron/supabase-auth";
import type { CloudVaultArchive } from "../shared/types";

const fake = vi.hoisted(() => ({
  createClient: vi.fn(), signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), setSession: vi.fn(), getUser: vi.fn(),
  startAutoRefresh: vi.fn(), stopAutoRefresh: vi.fn(), onAuthStateChange: vi.fn(),
  result: vi.fn(), update: vi.fn(), insert: vi.fn()
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: fake.createClient }));
const session = { access_token: "fixture-access", refresh_token: "fixture-refresh", user: { id: "alice", email: "alice@example.test" } };
const archive: CloudVaultArchive = { schemaVersion: 1, exportedAt: "2026-09-01T00:00:00.000Z", files: {}, progress: { schemaVersion: 2, topics: {}, reviewEvents: [] }, planner: { schemaVersion: 1, revision: 0, plans: [] } };
let root: string;
let auth: SupabaseAuth;
let onEvent: (event: string, value: typeof session | null) => void;
beforeEach(async () => {
  vi.resetAllMocks();
  root = await fs.mkdtemp(path.join(tmpdir(), "revember-auth-"));
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: fake.result, single: fake.result, update: fake.update, insert: fake.insert };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  fake.update.mockReturnValue(query); fake.insert.mockReturnValue(query);
  fake.onAuthStateChange.mockImplementation((callback) => { onEvent = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
  fake.createClient.mockReturnValue({ auth: {
    signInWithPassword: fake.signIn, signUp: fake.signUp, signOut: fake.signOut, setSession: fake.setSession, getUser: fake.getUser,
    onAuthStateChange: fake.onAuthStateChange, startAutoRefresh: fake.startAutoRefresh, stopAutoRefresh: fake.stopAutoRefresh
  }, from: () => query });
  fake.signIn.mockResolvedValue({ data: { session, user: session.user }, error: null });
  fake.setSession.mockResolvedValue({ data: { session, user: session.user }, error: null });
  fake.signUp.mockResolvedValue({ data: { session: null, user: session.user }, error: null });
  fake.getUser.mockResolvedValue({ data: { user: session.user }, error: null });
  auth = createAuth();
});
afterEach(async () => { auth.dispose(); await fs.rm(root, { recursive: true, force: true }); });
function createAuth() { return new SupabaseAuth({ sessionPath: path.join(root, "session.json"), url: "https://example.supabase.co", publishableKey: "fixture-key" }); }

it("keeps rotated tokens on disk with owner-only permissions, and ignores refresh after logout", async () => {
  await auth.signIn("alice@example.test", "fixture-password");
  onEvent("TOKEN_REFRESHED", { ...session, refresh_token: "rotated" });
  const file = path.join(root, "session.json");
  expect(JSON.parse(await fs.readFile(file, "utf8")).refresh_token).toBe("rotated");
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  expect(auth.state).not.toHaveProperty("access_token");
  await auth.signOut();
  onEvent("TOKEN_REFRESHED", session);
  await expect(fs.access(file)).rejects.toThrow();
  await expect(auth.getCloudSyncState()).rejects.toThrow(/sign in/i);
});

it("clears local authentication even if logout throws", async () => {
  await auth.signIn("alice@example.test", "fixture-password");
  fake.signOut.mockRejectedValue(new Error("offline"));
  await expect(auth.signOut()).rejects.toThrow("offline");
  expect(auth.state.user).toBeUndefined();
  await expect(fs.access(path.join(root, "session.json"))).rejects.toThrow();
});

it("keeps saved tokens when session restore fails with a retryable network error", async () => {
  const file = path.join(root, "session.json");
  await fs.writeFile(file, JSON.stringify(session));
  fake.setSession.mockResolvedValue({ data: {}, error: { name: "AuthRetryableFetchError", message: "offline" } });
  await expect(auth.restore()).rejects.toMatchObject({ name: "AuthRetryableFetchError" });
  expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(session);
});

it("serializes restoration and signout so a late restore cannot sign the user back in", async () => {
  await fs.writeFile(path.join(root, "session.json"), JSON.stringify(session));
  let resolve!: (value: unknown) => void;
  fake.setSession.mockReturnValue(new Promise(done => { resolve = done; }));
  const restoring = auth.restore();
  await Promise.resolve();
  const signingOut = auth.signOut();
  resolve({ data: { session, user: session.user }, error: null });
  await restoring; await signingOut;
  expect(auth.state.user).toBeUndefined();
});

it("rejects an unrelated callback URL and unsolicited account replacement", async () => {
  await expect(auth.completeEmailCallback("https://evil.test/#access_token=x&refresh_token=y")).rejects.toThrow(/invalid.*callback/i);
  expect(fake.setSession).not.toHaveBeenCalled();
  await auth.signIn("alice@example.test", "fixture-password");
  await expect(auth.completeEmailCallback("revember://auth/callback#access_token=x&refresh_token=y")).rejects.toThrow(/sign out/i);
  expect(fake.setSession).not.toHaveBeenCalled();
});

it("binds confirmation to a locally initiated signup and rejects callback substitution", async () => {
  await expect(auth.completeEmailCallback("revember://auth/callback#access_token=x&refresh_token=y")).rejects.toThrow(/start account creation/i);
  await auth.signUp("alice@example.test", "fixture-password");
  const redirect = fake.signUp.mock.calls[0][0].options.emailRedirectTo;
  fake.getUser.mockResolvedValueOnce({ data: { user: { email: "attacker@example.test" } }, error: null });
  await expect(auth.completeEmailCallback(`${redirect}#access_token=x&refresh_token=y`)).rejects.toThrow(/does not match/i);
  expect(fake.setSession).not.toHaveBeenCalled();
  expect((await auth.completeEmailCallback(`${redirect}#access_token=x&refresh_token=y`)).user?.id).toBe("alice");
  await expect(fs.access(path.join(root, "session.json.confirmation.json"))).rejects.toThrow();
});

it("does not overwrite a remote snapshot never downloaded by this device", async () => {
  await auth.signIn("alice@example.test", "fixture-password");
  fake.result.mockResolvedValue({ data: { revision: 8, updated_at: "now" }, error: null });
  await auth.getCloudSyncState();
  await expect(auth.uploadVault(archive)).rejects.toThrow(/download/i);
  expect(fake.update).not.toHaveBeenCalled();
});

it("persists the local base revision and rejects a sequential stale-device overwrite after restart", async () => {
  await auth.signIn("alice@example.test", "fixture-password");
  auth.confirmDownloadedRevision(1);
  fake.result.mockResolvedValueOnce({ data: { revision: 1 }, error: null })
    .mockResolvedValueOnce({ data: { revision: 2, updated_at: "2026-09-01T00:00:00Z" }, error: null });
  expect((await auth.uploadVault(archive)).revision).toBe(2);
  auth.dispose(); auth = createAuth();
  await auth.restore();
  fake.result.mockResolvedValueOnce({ data: { revision: 3 }, error: null });
  await expect(auth.uploadVault(archive)).rejects.toThrow(/download/i);
  expect(fake.update).toHaveBeenCalledTimes(1);
});

it("does not advance the local revision merely by fetching a snapshot", async () => {
  await auth.signIn("alice@example.test", "fixture-password");
  fake.result.mockResolvedValue({ data: { revision: 5, vault: archive, updated_at: "now" }, error: null });
  await auth.downloadVault();
  await expect(auth.uploadVault(archive)).rejects.toThrow(/download/i);
});

it("rejects a concurrent conditional-write miss without advancing the local revision", async () => {
  await auth.signIn("alice@example.test", "fixture-password");
  auth.confirmDownloadedRevision(1);
  fake.result.mockResolvedValueOnce({ data: { revision: 1 }, error: null }).mockResolvedValueOnce({ data: null, error: null });
  await expect(auth.uploadVault(archive)).rejects.toThrow(/changed on another device/i);
  expect(JSON.parse(await fs.readFile(path.join(root, "session.json.vault-revisions.json"), "utf8"))).toEqual({ alice: 1 });
});
