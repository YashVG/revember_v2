import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const fixtureUserID = "00000000-0000-4000-8000-000000000001";

export async function fixtureArchive(root) {
  const files = {};
  for (const directory of ["topics", "notes", "captures", "sessions"]) {
    const entries = await readdir(path.join(root, directory), { recursive: true, withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const filePath = path.join(entry.parentPath, entry.name);
      const relative = path.relative(root, filePath).split(path.sep).join("/");
      if (entry.isFile() && /\.(md|json)$/.test(entry.name) && !relative.split("/").some(part => part.startsWith("."))) {
        files[relative] = await readFile(filePath, "utf8");
      }
    }
  }
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), files,
    progress: { schemaVersion: 2, topics: {}, reviewEvents: [] }, planner: { schemaVersion: 1, revision: 0, plans: [] } };
}

// Test-runner instrumentation only: no production auth bypass or real tokens.
// Real Supabase client/IPC/persistence code still executes in the Electron app.
export async function installAuthFixture(app, archive) {
  await app.evaluate((_electron, { archive, aliceID }) => {
    const users = {
      "alice@example.test": { id: aliceID, email: "alice@example.test" },
      "bob@example.test": { id: "00000000-0000-4000-8000-000000000002", email: "bob@example.test" }
    };
    const nativeFetch = globalThis.fetch;
    const rows = new Map([[aliceID, { user_id: aliceID, revision: 1, updated_at: new Date().toISOString(), vault: archive }]]);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const session = (user) => {
      const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
      const access_token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.c2lnbmF0dXJl`;
      return { access_token, refresh_token: user.email, token_type: "bearer", expires_in: 3600, user };
    };
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url ?? input.toString());
      if (url.hostname !== "supabase.fixture.invalid") return nativeFetch(input, init);
      const body = init.body ? JSON.parse(init.body) : {};
      if (url.pathname.endsWith("/token")) {
        const user = users[body.email ?? body.refresh_token];
        if (!user || (body.password && body.password !== "fixture-password")) return json({ msg: "Invalid login credentials" }, 400);
        return json(session(user));
      }
      const token = new Headers(init.headers).get("Authorization")?.replace(/^Bearer /, "");
      let user;
      try { user = Object.values(users).find(user => user.id === JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub); } catch {}
      if (!user) return json({ message: "Unauthorized" }, 401);
      if (url.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
      if (url.pathname.endsWith("/user")) return json(user);
      if (url.pathname.endsWith("/vault_snapshots")) {
        const id = url.searchParams.get("user_id")?.replace(/^eq\./, "") ?? body.user_id;
        if (id !== user.id) return json({ message: "RLS denied" }, 403);
        let row = rows.get(id);
        if (init.method === "POST") {
          if (row) return json({ code: "23505", message: "duplicate" }, 409);
          row = body; rows.set(id, row);
        } else if (init.method === "PATCH") {
          if (!row || url.searchParams.get("revision") !== `eq.${row.revision}`) return json([]);
          row = { ...row, ...body }; rows.set(id, row);
        }
        const single = new Headers(init.headers).get("Accept")?.includes("vnd.pgrst.object");
        return single ? (row ? json(row) : json({ code: "PGRST116", message: "No rows" }, 406)) : json(row ? [row] : []);
      }
      return json({ message: "Unexpected fixture request" }, 404);
    };
  }, { archive, aliceID: fixtureUserID });
}
