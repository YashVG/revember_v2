import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, type RevemberConfig } from "./config.js";
import { ensureKnowledgeDirs } from "./paths.js";
import { backendFetch, HttpError, type CloudOptions } from "./cloud-auth.js";

const directories = ["topics", "notes", "captures", "capture-enrichments", "capture-segmentations", "sessions"];
const maxBytes = 7_500_000;
export interface CloudArchive {
  schemaVersion: 1;
  exportedAt: string;
  files: Record<string, string>;
  progress: Record<string, unknown>;
  planner: Record<string, unknown>;
}

export function validateArchive(value: unknown): CloudArchive {
  if (!value || typeof value !== "object" || Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new HttpError(422, "Invalid or oversized cloud vault.");
  const archive = value as CloudArchive;
  if (archive.schemaVersion !== 1 || typeof archive.exportedAt !== "string" || !Number.isFinite(Date.parse(archive.exportedAt))
    || !isObject(archive.files) || !isObject(archive.progress) || !isObject(archive.planner)) throw new HttpError(422, "Invalid cloud vault format.");
  const names = new Set<string>();
  for (const [name, contents] of Object.entries(archive.files)) {
    const segments = name.split("/");
    if (typeof contents !== "string" || segments.length < 2 || !directories.includes(segments[0]!)
      || segments.some(segment => !segment || segment.startsWith(".") || /[\\\x00-\x1f:]/.test(segment))
      || !/\.(json|md)$/.test(name)) throw new HttpError(422, "Unsafe cloud vault file path.");
    const canonical = name.normalize("NFC").toLowerCase();
    if (names.has(canonical)) throw new HttpError(422, "Colliding cloud vault paths.");
    names.add(canonical);
    if (name.endsWith(".json")) {
      try { JSON.parse(contents); } catch { throw new HttpError(422, "Invalid JSON in cloud vault."); }
    }
  }
  for (const name of names) {
    const segments = name.split("/");
    for (let i = 1; i < segments.length; i++) if (names.has(segments.slice(0, i).join("/"))) throw new HttpError(422, "Colliding cloud vault paths.");
  }
  return archive;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function loadCloudVault(options: CloudOptions, accessToken: string, userID: string): Promise<{ archive: CloudArchive; revision: number }> {
  const response = await backendFetch(options, accessToken, `/rest/v1/vault_snapshots?user_id=eq.${encodeURIComponent(userID)}&select=revision,vault`);
  if (response.status === 401 || response.status === 403) throw new HttpError(401, "Sign in to Revember again.");
  if (!response.ok) throw new HttpError(502, "Cloud vault is temporarily unavailable.");
  const rows = await boundedJson(response) as { revision: number; vault: unknown }[];
  if (!Array.isArray(rows)) throw new HttpError(422, "Invalid cloud vault response.");
  if (!rows.length) throw new HttpError(409, "Upload your vault in Revember Settings → Cloud Vault before using hosted MCP.");
  if (rows.length !== 1 || !Number.isSafeInteger(rows[0]!.revision) || rows[0]!.revision < 1) throw new HttpError(422, "Invalid cloud vault revision.");
  return { archive: validateArchive(rows[0]!.vault), revision: rows[0]!.revision };
}

export async function saveCloudVault(options: CloudOptions, accessToken: string, userID: string, revision: number, archive: CloudArchive): Promise<void> {
  validateArchive(archive);
  const response = await backendFetch(options, accessToken, `/rest/v1/vault_snapshots?user_id=eq.${encodeURIComponent(userID)}&revision=eq.${revision}&select=revision`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ schema_version: 1, revision: revision + 1, vault: archive, updated_at: new Date().toISOString() })
  });
  if (response.status === 401 || response.status === 403) throw new HttpError(401, "Sign in to Revember again.");
  if (!response.ok) throw new HttpError(502, "Cloud write could not be confirmed. Read the vault before retrying.");
  const rows = await boundedJson(response) as unknown[];
  if (!Array.isArray(rows) || rows.length !== 1) throw new HttpError(409, "Cloud vault changed during this request. Read it again before retrying; this change was not saved.");
}

async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, "Empty cloud vault response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    // Allow the row wrapper without accepting an unbounded database response.
    if (size > maxBytes + 100_000) { await reader.cancel(); throw new HttpError(422, "Oversized cloud vault response."); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(502, "Invalid cloud vault response."); }
}

export async function withTemporaryVault<T>(archive: CloudArchive, operation: (config: RevemberConfig, collect: () => Promise<CloudArchive>) => Promise<T>): Promise<T> {
  validateArchive(archive);
  const root = await fs.mkdtemp(path.join(tmpdir(), "revember-cloud-"));
  try {
    const config = loadConfig({ REVEMBER_KNOWLEDGE_ROOT: path.join(root, "knowledge"), REVEMBER_PROGRESS_PATH: path.join(root, "progress.json") });
    await ensureKnowledgeDirs(config);
    for (const [name, contents] of Object.entries(archive.files)) {
      const target = path.join(config.knowledgeRoot, name);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, contents, { mode: 0o600 });
    }
    await fs.writeFile(config.progressPath, JSON.stringify(archive.progress), { mode: 0o600 });
    return await operation(config, async () => {
      const files: Record<string, string> = {};
      const visit = async (directory: string): Promise<void> => {
        const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
          if (error.code === "ENOENT") return []; throw error;
        });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const target = path.join(directory, entry.name);
          if (entry.isSymbolicLink()) throw new HttpError(422, "Links are not supported in cloud vaults.");
          if (entry.isDirectory()) await visit(target);
          else if (entry.isFile() && /\.(json|md)$/.test(entry.name)) files[path.relative(config.knowledgeRoot, target).split(path.sep).join("/")] = await fs.readFile(target, "utf8");
        }
      };
      for (const directory of directories) await visit(path.join(config.knowledgeRoot, directory));
      return validateArchive({ ...archive, files, exportedAt: new Date().toISOString() });
    });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}
