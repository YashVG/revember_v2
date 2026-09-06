import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthActionResult, AuthState, CloudSyncResult, CloudSyncState, CloudVaultArchive } from "../shared/types";
import { writeJsonAtomically } from "./persistence";

interface SupabaseAuthOptions {
  sessionPath: string;
  url?: string;
  publishableKey?: string;
}

interface RemoteVaultRow {
  revision: number;
  updated_at: string;
  vault: CloudVaultArchive;
}

/**
 * Keeps Supabase credentials and tokens out of the renderer. The publishable
 * key identifies the project; database access is still limited by RLS and the
 * user session that this service owns.
 */
export class SupabaseAuth extends EventEmitter {
  private readonly client?: SupabaseClient;
  private readonly configurationError?: string;
  private user?: AuthState["user"];
  private unsubscribe?: () => void;
  private authQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: SupabaseAuthOptions) {
    super();
    const url = options.url?.trim();
    const publishableKey = options.publishableKey?.trim();
    if (!url && !publishableKey) {
      this.configurationError = "Cloud sign-in is not configured for this build.";
      return;
    }
    if (!url || !publishableKey) {
      this.configurationError = "Cloud sign-in needs both a Supabase URL and publishable key.";
      return;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") throw new Error("The Supabase URL must use HTTPS.");
      this.client = createClient(parsed.href, publishableKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: false
        }
      });
      const { data } = this.client.auth.onAuthStateChange((event, session) => {
        if (event === "TOKEN_REFRESHED" && session && this.user?.id === session.user.id) {
          this.persistSession(session);
        } else if (event === "SIGNED_OUT") {
          this.user = undefined;
          try { this.clearSession(); } finally { this.broadcast(); }
        }
      });
      this.unsubscribe = () => data.subscription.unsubscribe();
    } catch (error) {
      this.configurationError = error instanceof Error ? error.message : "Cloud sign-in is misconfigured.";
    }
  }

  get state(): AuthState {
    return {
      configured: Boolean(this.client),
      ...(this.configurationError ? { configurationError: this.configurationError } : {}),
      ...(this.user ? { user: this.user } : {})
    };
  }

  async restore(): Promise<AuthState> {
    return this.enqueueAuth(() => this.restoreSession());
  }

  private async restoreSession(): Promise<AuthState> {
    if (!this.client) return this.state;
    const saved = this.readSession();
    if (!saved) return this.state;
    const { data, error } = await this.client.auth.setSession(saved);
    if (error || !data.session || !data.user) {
      if (error?.name === "AuthRetryableFetchError") throw error;
      this.clearSession();
      return this.state;
    }
    this.persistSession(data.session);
    this.setUser(data.user.id, data.user.email);
    return this.state;
  }

  async signUp(email: string, password: string): Promise<AuthActionResult> {
    return this.enqueueAuth(() => this.createAccount(email, password));
  }

  private async createAccount(email: string, password: string): Promise<AuthActionResult> {
    const client = this.requireClient();
    const normalizedEmail = normalizeEmail(email);
    const normalizedPassword = normalizePassword(password);
    if (this.user) throw new Error("Sign out before creating another account.");
    mkdirSync(path.dirname(this.options.sessionPath), { recursive: true });
    const pendingPath = `${this.options.sessionPath}.confirmation.json`;
    writeJsonAtomically(pendingPath, { email: normalizedEmail, createdAt: Date.now() });
    const { data, error } = await client.auth.signUp({
      email: normalizedEmail,
      password: normalizedPassword,
      options: { emailRedirectTo: "revember://auth/callback" }
    }).catch(error => { rmSync(pendingPath, { force: true }); throw error; });
    if (error) { rmSync(pendingPath, { force: true }); throw new Error(error.message); }
    if (data.session && data.user) {
      rmSync(pendingPath, { force: true });
      this.persistSession(data.session);
      this.setUser(data.user.id, data.user.email);
      return { state: this.state, requiresEmailConfirmation: false };
    }
    return { state: this.state, requiresEmailConfirmation: true };
  }

  async signIn(email: string, password: string): Promise<AuthActionResult> {
    return this.enqueueAuth(() => this.startSession(email, password));
  }

  private async startSession(email: string, password: string): Promise<AuthActionResult> {
    const client = this.requireClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: normalizeEmail(email),
      password: normalizePassword(password)
    });
    if (error || !data.session || !data.user) throw new Error(error?.message ?? "Could not start a session.");
    this.persistSession(data.session);
    this.setUser(data.user.id, data.user.email);
    return { state: this.state, requiresEmailConfirmation: false };
  }

  async signOut(): Promise<AuthState> {
    return this.enqueueAuth(async () => {
      try {
        if (this.client) await this.client.auth.signOut({ scope: "local" });
      } finally {
        this.user = undefined;
        this.broadcast();
        try { await this.client?.auth.stopAutoRefresh(); }
        finally {
          this.clearSession();
          rmSync(`${this.options.sessionPath}.confirmation.json`, { force: true });
        }
      }
      return this.state;
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    void this.client?.auth.stopAutoRefresh();
  }

  private enqueueAuth<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.authQueue.then(operation);
    this.authQueue = next.catch(() => undefined);
    return next;
  }

  async getCloudSyncState(): Promise<CloudSyncState> {
    const { client, user } = this.requireSignedInClient();
    const { data, error } = await client
      .from("vault_snapshots")
      .select("revision, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      configured: true,
      hasRemoteVault: Boolean(data),
      ...(data ? { revision: Number(data.revision), updatedAt: data.updated_at } : {})
    };
  }

  async uploadVault(archive: CloudVaultArchive): Promise<CloudSyncResult> {
    const { client, user } = this.requireSignedInClient();
    const { data: current, error: readError } = await client
      .from("vault_snapshots")
      .select("revision, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    // The expected revision belongs to the local copy, not a fresh server
    // read. Otherwise an older device can overwrite newer work sequentially.
    const revisions = this.readRevisions();
    if (current && revisions[user.id] !== Number(current.revision)) {
      throw new Error("Your cloud vault changed or has not been downloaded on this device. Download it before uploading; a local backup will be kept.");
    }
    if (this.user !== user) throw new Error("Account changed during upload.");
    const nextRevision = current ? Number(current.revision) + 1 : 1;
    const row = {
      user_id: user.id,
      schema_version: 1,
      revision: nextRevision,
      vault: archive,
      updated_at: new Date().toISOString()
    };
    const write = current
      ? client.from("vault_snapshots").update(row).eq("user_id", user.id).eq("revision", Number(current.revision)).select("revision, updated_at").maybeSingle()
      : client.from("vault_snapshots").insert(row).select("revision, updated_at").single();
    const { data, error } = await write;
    if (error) throw new Error(error.code === "23505" ? "Your cloud vault changed on another device. Download it before uploading." : error.message);
    if (!data) throw new Error("Your cloud vault changed on another device. Refresh it before uploading again.");
    if (this.user !== user) throw new Error("Account changed during upload. Download the cloud vault before continuing.");
    this.saveRevision(user.id, Number(data.revision));
    return {
      configured: true,
      hasRemoteVault: true,
      revision: Number(data.revision),
      updatedAt: data.updated_at,
      syncedAt: data.updated_at
    };
  }

  async downloadVault(): Promise<{ archive: CloudVaultArchive; sync: CloudSyncResult }> {
    const { client, user } = this.requireSignedInClient();
    const { data, error } = await client
      .from("vault_snapshots")
      .select("revision, updated_at, vault")
      .eq("user_id", user.id)
      .single();
    if (error) throw new Error(error.code === "PGRST116" ? "No cloud vault exists for this account yet." : error.message);
    const row = data as RemoteVaultRow;
    return {
      archive: row.vault,
      sync: {
        configured: true,
        hasRemoteVault: true,
        revision: Number(row.revision),
        updatedAt: row.updated_at,
        syncedAt: row.updated_at
      }
    };
  }

  async completeEmailCallback(rawURL: string): Promise<AuthState> {
    return this.enqueueAuth(() => this.finishEmailCallback(rawURL));
  }

  private async finishEmailCallback(rawURL: string): Promise<AuthState> {
    const client = this.requireClient();
    const parsed = new URL(rawURL);
    if (parsed.protocol !== "revember:" || parsed.hostname !== "auth" || parsed.pathname !== "/callback" || parsed.username || parsed.password || parsed.port) {
      throw new Error("Invalid email confirmation callback.");
    }
    if (this.user) throw new Error("Sign out before confirming a different session.");
    let pending: { email: string; createdAt: number };
    try { pending = JSON.parse(readFileSync(`${this.options.sessionPath}.confirmation.json`, "utf8")); }
    catch { throw new Error("Start account creation in this app before opening a confirmation link."); }
    if (typeof pending.email !== "string" || !Number.isFinite(pending.createdAt)
      || Date.now() - pending.createdAt > 86_400_000 || pending.createdAt > Date.now()) {
      throw new Error("This confirmation link does not match the pending account request or has expired.");
    }
    const parameters = new URLSearchParams(parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash);
    const accessToken = parameters.get("access_token");
    const refreshToken = parameters.get("refresh_token");
    if (!accessToken || !refreshToken) throw new Error("The email confirmation link did not include a session.");
    // A verified identity must match the email the user explicitly entered on
    // this device. An arbitrary deep link must not install an attacker's session.
    const verified = await client.auth.getUser(accessToken);
    if (verified.error || verified.data.user?.email?.toLowerCase() !== pending.email) throw new Error("The confirmation account does not match your signup request.");
    const { data, error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error || !data.session || !data.user) throw new Error(error?.message ?? "Could not finish email confirmation.");
    if (data.user.id !== verified.data.user.id) throw new Error("The confirmation session changed accounts.");
    this.persistSession(data.session);
    rmSync(`${this.options.sessionPath}.confirmation.json`, { force: true });
    this.setUser(data.user.id, data.user.email);
    return this.state;
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error(this.configurationError ?? "Cloud sign-in is unavailable.");
    return this.client;
  }

  confirmDownloadedRevision(revision: number): void {
    const { user } = this.requireSignedInClient();
    this.saveRevision(user.id, revision);
  }

  private readRevisions(): Record<string, number> {
    const filePath = `${this.options.sessionPath}.vault-revisions.json`;
    if (!existsSync(filePath)) return {};
    const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.values(raw).some(value => !Number.isSafeInteger(value) || value < 1)) {
      throw new Error("Saved cloud revision state is invalid. Restore it before uploading.");
    }
    return raw as Record<string, number>;
  }

  private saveRevision(userID: string, revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid cloud revision.");
    const revisions = this.readRevisions();
    revisions[userID] = revision;
    writeJsonAtomically(`${this.options.sessionPath}.vault-revisions.json`, revisions);
  }

  private requireSignedInClient(): { client: SupabaseClient; user: NonNullable<AuthState["user"]> } {
    const client = this.requireClient();
    if (!this.user) throw new Error("Sign in before syncing your vault.");
    return { client, user: this.user };
  }

  private setUser(id: string, email: string | undefined): void {
    this.user = { id, email: email ?? "" };
    void this.client?.auth.startAutoRefresh();
    this.broadcast();
  }

  private broadcast(): void {
    this.emit("state", this.state);
  }

  private readSession(): Session | undefined {
    if (!existsSync(this.options.sessionPath)) return undefined;
    try {
      const value = JSON.parse(readFileSync(this.options.sessionPath, "utf8")) as Session;
      if (!value?.access_token || !value?.refresh_token) throw new Error("missing token");
      return value;
    } catch {
      this.clearSession();
      return undefined;
    }
  }

  private persistSession(session: Session): void {
    mkdirSync(path.dirname(this.options.sessionPath), { recursive: true });
    writeJsonAtomically(this.options.sessionPath, session);
  }

  private clearSession(): void {
    rmSync(this.options.sessionPath, { force: true });
  }
}

function normalizeEmail(rawEmail: string): string {
  if (typeof rawEmail !== "string") throw new Error("Enter a valid email address.");
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Enter a valid email address.");
  return email;
}

function normalizePassword(rawPassword: string): string {
  if (typeof rawPassword !== "string" || rawPassword.length < 8) throw new Error("Use a password with at least 8 characters.");
  return rawPassword;
}
