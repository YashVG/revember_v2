import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthActionResult, AuthState } from "../shared/types";
import { writeJsonAtomically } from "./persistence";

interface SupabaseAuthOptions {
  sessionPath: string;
  url?: string;
  publishableKey?: string;
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
