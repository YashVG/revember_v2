import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, exchangeToken, HttpError, type CloudOptions } from "./cloud-auth.js";
import { loadCloudVault, saveCloudVault, withTemporaryVault } from "./cloud-vault.js";
import { createServer } from "./server.js";

const writeTools = new Set(["create_topic", "update_topic", "upsert_concept", "upsert_card", "retire_card", "update_markdown_explanation", "capture_learning_session"]);
const maxRequestBytes = 1_000_000;

export function createHttpHandler(options: CloudOptions): (request: Request) => Promise<Response> {
  if (!options.supabaseUrl.startsWith("https://") || options.tokenSecret.length < 32) throw new Error("Hosted MCP configuration is incomplete.");
  return async request => {
    let rpcID: string | number | null = null;
    try {
      const url = new URL(request.url);
      if (url.origin !== new URL(options.audience).origin) throw new HttpError(403, "Invalid host.");
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) throw new HttpError(403, "Origin is not allowed.");
      if (url.pathname === "/health" && request.method === "GET") return json({ status: "ok", service: "revember-mcp" });
      if (url.pathname !== "/mcp" && url.pathname !== "/connect") throw new HttpError(404, "Not found.");
      if (request.method !== "POST") return json({ error: "Use POST. This server does not provide an SSE subscription." }, 405, { Allow: "POST" });
      if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) throw new HttpError(415, "Use application/json.");
      const raw = await limitedBody(request);
      let body: any;
      try { body = JSON.parse(raw); } catch { throw new HttpError(400, "Invalid JSON."); }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Send one JSON request at a time.");
      if (url.pathname === "/connect") {
        if (typeof body.accessToken !== "string" || body.accessToken.length > 12000) throw new HttpError(400, "An account access token is required.");
        return json(await exchangeToken(options, body.accessToken));
      }
      if (typeof body.id === "string" || typeof body.id === "number") rpcID = body.id;
      const match = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i);
      if (!match) throw new HttpError(401, "Connect using your Revember account first.");
      const identity = authenticate(options, match[1]!);
      const { archive, revision } = await loadCloudVault(options, identity.accessToken, identity.userID);
      return await withTemporaryVault(archive, async (config, collect) => {
        const server = createServer(config);
        const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
        try {
          await server.connect(transport);
          const response = await transport.handleRequest(request, { parsedBody: body });
          const responseBody = await response.text();
          // Lambda's buffered response limit includes JSON escaping overhead.
          if (Buffer.byteLength(JSON.stringify(responseBody)) > 5_000_000) throw new HttpError(413, "MCP response is too large. Narrow the request.");
          if (response.ok && body.method === "tools/call" && writeTools.has(body.params?.name)) {
            const result = JSON.parse(responseBody);
            if (!result.error && !result.result?.isError) {
              await saveCloudVault(options, identity.accessToken, identity.userID, revision, await collect());
            }
          }
          return new Response(responseBody || null, { status: response.status, headers: { ...Object.fromEntries(response.headers), "Cache-Control": "no-store" } });
        } finally { await server.close(); }
      });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "MCP request failed. No success was confirmed; read the vault before retrying.";
      return json({ jsonrpc: "2.0", id: rpcID, error: { code: -32000, message } }, status,
        status === 401 ? { "WWW-Authenticate": 'Bearer realm="revember-mcp"' } : {});
    }
  };
}

async function limitedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxRequestBytes) { await reader.cancel(); throw new HttpError(413, "MCP request is too large."); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
