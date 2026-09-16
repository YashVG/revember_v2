import { createHttpHandler } from "./http.js";

interface HttpApiEvent {
  rawPath: string;
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string }; domainName: string };
}

export async function handler(event: HttpApiEvent) {
  const audience = process.env.REVEMBER_MCP_AUDIENCE!;
  const handle = createHttpHandler({
    audience,
    supabaseUrl: process.env.REVEMBER_SUPABASE_URL!,
    publishableKey: process.env.REVEMBER_SUPABASE_PUBLISHABLE_KEY!,
    tokenSecret: process.env.REVEMBER_MCP_TOKEN_SECRET!
  });
  if (event.requestContext.domainName !== new URL(audience).host) return { statusCode: 403, body: "Forbidden" };
  const headers = Object.fromEntries(Object.entries(event.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const method = event.requestContext.http.method;
  const body = event.body ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8") : undefined;
  const response = await handle(new Request(new URL(event.rawPath, audience), {
    method, headers, ...(method !== "GET" && method !== "HEAD" && body ? { body } : {})
  }));
  return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: await response.text(), isBase64Encoded: false };
}
