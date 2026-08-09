import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DocumentLabService } from "../electron/document-lab";

const liveIt = process.env.REVEMBER_LIVE_OLLAMA === "1" ? it : it.skip;
let temporaryRoot: string | undefined;

afterAll(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

describe("Document Lab live Ollama", () => {
  liveIt("generates a grounded temporary draft", async () => {
    const configuredSourcePath = process.env.REVEMBER_DOCUMENT_LAB_SOURCE;
    let sourcePath: string;
    if (configuredSourcePath) {
      sourcePath = configuredSourcePath;
    } else {
      temporaryRoot = await mkdtemp(path.join(tmpdir(), "revember-document-lab-live-"));
      sourcePath = path.join(temporaryRoot, "ble.txt");
      await writeFile(sourcePath, [
        "Bluetooth Low Energy is a wireless protocol for low-power devices.",
        "A peripheral sends advertisements. A central device can scan for them and start a connection.",
        "GATT organizes data into services and characteristics."
      ].join("\n\n"), "utf8");
    }
    const service = new DocumentLabService();
    const [file] = await service.registerFiles([sourcePath]);

    const result = await service.generate(file!.id);

    if (configuredSourcePath) console.log(JSON.stringify(result.draft, null, 2));

    expect(result.draft.sections.length).toBeGreaterThan(0);
    const evidence = result.draft.sections
      .flatMap((section) => section.bullets.flatMap((bullet) => bullet.evidence));
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((quote) => result.extraction.textPreview?.includes(quote))).toBe(true);
    service.clear();
  }, 300_000);
});
