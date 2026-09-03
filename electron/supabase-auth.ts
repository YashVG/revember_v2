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
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false
        }
      });
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
    if (!this.client) return this.state;
    const saved = this.readSession();
    if (!saved) return this.state;
    const { data, error } = await this.client.auth.setSession(saved);
    if (error || !data.session || !data.user) {
      this.clearSession();
      return this.state;
    }
    this.persistSession(data.session);
    this.setUser(data.user.id, data.user.email);
    return this.state;
  }

  async signUp(email: string, password: string): Promise<AuthActionResult> {
    const client = this.requireClient();
    const { data, error } = await client.auth.signUp({
      email: normalizeEmail(email),
      password: normalizePassword(password),
      options: { emailRedirectTo: "revember://auth/callback" }
    });
    if (error) throw new Error(error.message);
    if (data.session && data.user) {
      this.persistSession(data.session);
      this.setUser(data.user.id, data.user.email);
      return { state: this.state, requiresEmailConfirmation: false };
    }
    return { state: this.state, requiresEmailConfirmation: true };
  }

  async signIn(email: string, password: string): Promise<AuthActionResult> {
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
    if (this.client) await this.client.auth.signOut({ scope: "local" });
    this.clearSession();
    this.user = undefined;
    this.broadcast();
    return this.state;
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
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Your cloud vault changed on another device. Refresh it before uploading again.");
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
    const client = this.requireClient();
    const parsed = new URL(rawURL);
    const parameters = new URLSearchParams(parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash);
    const accessToken = parameters.get("access_token");
    const refreshToken = parameters.get("refresh_token");
    if (!accessToken || !refreshToken) throw new Error("The email confirmation link did not include a session.");
    const { data, error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error || !data.session || !data.user) throw new Error(error?.message ?? "Could not finish email confirmation.");
    this.persistSession(data.session);
    this.setUser(data.user.id, data.user.email);
    return this.state;
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw new Error(this.configurationError ?? "Cloud sign-in is unavailable.");
    return this.client;
  }

  private requireSignedInClient(): { client: SupabaseClient; user: NonNullable<AuthState["user"]> } {
    const client = this.requireClient();
    if (!this.user) throw new Error("Sign in before syncing your vault.");
    return { client, user: this.user };
  }

  private setUser(id: string, email: string | undefined): void {
    this.user = { id, email: email ?? "" };
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
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Enter a valid email address.");
  return email;
}

function normalizePassword(rawPassword: string): string {
  if (rawPassword.length < 8) throw new Error("Use a password with at least 8 characters.");
  return rawPassword;
}
