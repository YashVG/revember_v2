import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export interface CloudOptions {
  supabaseUrl: string;
  publishableKey: string;
  tokenSecret: string;
  audience: string;
  fetch?: typeof fetch;
}

interface CloudIdentity {
  userID: string;
  accessToken: string;
  audience: string;
  expiresAt: number;
}

export function backendFetch(options: CloudOptions, token: string, route: string, init: RequestInit = {}): Promise<Response> {
  return (options.fetch ?? fetch)(`${options.supabaseUrl}${route}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
    headers: { apikey: options.publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers }
  });
}

// Exchange a verified account session for a short-lived, audience-bound MCP
// credential. Supabase access tokens themselves are never accepted at /mcp.
export async function exchangeToken(options: CloudOptions, accessToken: string): Promise<{ token: string; expiresAt: number }> {
  const response = await backendFetch(options, accessToken, "/auth/v1/user");
  if (response.status === 401 || response.status === 403) throw new HttpError(401, "Sign in to Revember again.");
  if (!response.ok) throw new HttpError(502, "Account verification is temporarily unavailable.");
  const user = await response.json() as { id?: string; is_anonymous?: boolean };
  if (!user.id || !/^[a-f0-9-]{36}$/i.test(user.id) || user.is_anonymous) throw new HttpError(401, "A Revember account is required.");
  let claims: { exp?: number; sub?: string; iss?: string; aud?: string; role?: string };
  try { claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString()); }
  catch { throw new HttpError(401, "Invalid account session."); }
  // Claims are trusted only after the Auth server verified this exact token.
  const now = Math.floor(Date.now() / 1000);
  if (claims.sub !== user.id || claims.iss !== `${options.supabaseUrl}/auth/v1` || claims.aud !== "authenticated"
    || claims.role !== "authenticated" || !Number.isSafeInteger(claims.exp) || claims.exp! <= now) {
    throw new HttpError(401, "Invalid account session.");
  }
  const expiresAt = Math.min(claims.exp!, now + 900);
  const identity: CloudIdentity = { userID: user.id, accessToken, audience: options.audience, expiresAt };
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(options), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from("revember-mcp-v1"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(identity), "utf8"), cipher.final()]);
  const token = ["rv1", nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  return { token, expiresAt };
}

export function authenticate(options: CloudOptions, token: string): CloudIdentity {
  try {
    if (token.length > 16000) throw new Error();
    const parts = token.split(".");
    const [version, nonce, encrypted, tag] = parts;
    if (parts.length !== 4 || version !== "rv1" || !nonce || !encrypted || !tag
      || ![nonce, encrypted, tag].every(value => /^[A-Za-z0-9_-]+$/.test(value))) throw new Error();
    const nonceBytes = Buffer.from(nonce, "base64url");
    const tagBytes = Buffer.from(tag, "base64url");
    // Node permits truncated GCM tags unless their length is pinned. rv1 always
    // issues a 12-byte nonce and a full 16-byte authentication tag.
    if (nonceBytes.length !== 12 || tagBytes.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key(options), nonceBytes, { authTagLength: 16 });
    decipher.setAAD(Buffer.from("revember-mcp-v1"));
    decipher.setAuthTag(tagBytes);
    const identity: CloudIdentity = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString());
    if (identity.audience !== options.audience || identity.expiresAt <= Date.now() / 1000) throw new Error();
    return identity;
  } catch { throw new HttpError(401, "MCP connection expired. Reconnect through Revember."); }
}

function key(options: CloudOptions): Buffer {
  if (options.tokenSecret.length < 32) throw new Error("A generated MCP token secret is required.");
  return createHash("sha256").update(options.tokenSecret).digest();
}
