import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { DocumentLabService } from "../electron/document-lab";
import { DocumentTextExtractor } from "../electron/document-text-extractor";
import type { LocalNoteModel } from "../electron/ollama-note-model";

describe("DocumentLabService", () => {
  let root: string;
  let service: DocumentLabService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "revember-document-lab-"));
    service = new DocumentLabService();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns path-free metadata and extracts UTF-8 text", async () => {
    const sourcePath = path.join(root, "lecture.md");
    await writeFile(sourcePath, "# Radios\r\n\r\nA packet carries data.", "utf8");

    const [file] = await service.registerFiles([sourcePath]);
    expect(file).toMatchObject({ name: "lecture.md", extension: "md", kind: "markdown" });
    expect(file?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Object.values(file ?? {})).not.toContain(sourcePath);

    await expect(service.inspect(file!.id)).resolves.toMatchObject({
      file: { id: file!.id },
      extraction: {
        status: "extracted",
        textPreview: "# Radios\n\nA packet carries data.",
        previewLineCount: 3,
        previewTruncated: false
      }
    });
  });

  it.each([
    { extension: "docx", kind: "word", text: "Word lecture fact", bytes: docxFixture("Word lecture fact") },
    { extension: "pptx", kind: "slides", text: "Slide lecture fact", bytes: pptxFixture("Slide lecture fact") },
    { extension: "pdf", kind: "pdf", text: "PDF lecture fact", bytes: pdfFixture("PDF lecture fact") }
  ])("extracts $extension text locally", async ({ extension, kind, text, bytes }) => {
    const sourcePath = path.join(root, `lecture.${extension}`);
    await writeFile(sourcePath, bytes);
    const [file] = await service.registerFiles([sourcePath]);

    const inspection = await service.inspect(file!.id);
    expect(inspection.file.kind).toBe(kind);
    expect(inspection.extraction.status).toBe("extracted");
    expect(inspection.extraction.textPreview).toContain(text);
  });

  it("generates grounded memory notes without saving them", async () => {
    const sourcePath = path.join(root, "radio.txt");
    await writeFile(sourcePath, "A radio sends data with electromagnetic waves.\n\nA receiver detects the waves.", "utf8");
    const model: LocalNoteModel = {
      generateDocumentNotes: async (input) => ({
        sections: [{
          title: "Radio link",
          bullets: [{
            text: "A radio sends data with electromagnetic waves.",
            sourceBlockIDs: [input.sourceBlocks[0]!.id]
          }, {
            text: "The receiver detects the waves.",
            sourceBlockIDs: [input.sourceBlocks.at(-1)!.id]
          }]
        }]
      })
    };
    service = new DocumentLabService(new DocumentTextExtractor(), model);
    const [file] = await service.registerFiles([sourcePath]);

    const result = await service.generate(file!.id);
    expect(result.draft.sections[0]?.bullets[0]).toEqual({
      text: "A radio sends data with electromagnetic waves.",
      evidence: ["A radio sends data with electromagnetic waves."]
    });
    expect(result.draft.sections[0]?.bullets[1]).toEqual({
      text: "The receiver detects the waves.",
      evidence: ["A receiver detects the waves."]
    });
  });

  it("uses lecture goals as scope and removes course administration from evidence", async () => {
    const sourcePath = path.join(root, "lecture.txt");
    await writeFile(sourcePath, [
      "General Course Organisation and Evaluation\nThere will be 3 written exams.",
      "Learning goals:\nDefine a Turing machine.",
      "A Turing machine uses a tape and a finite set of internal states."
    ].join("\n\n"), "utf8");
    let modelInput: Parameters<NonNullable<LocalNoteModel["generateDocumentNotes"]>>[0] | undefined;
    const model: LocalNoteModel = {
      generateDocumentNotes: async (input) => {
        modelInput = input;
        return {
          sections: [{
            title: "Turing machine",
            bullets: [{ text: "A Turing machine uses a tape.", sourceBlockIDs: [input.sourceBlocks[0]!.id] }]
          }]
        };
      }
    };
    service = new DocumentLabService(new DocumentTextExtractor(), model);
    const [file] = await service.registerFiles([sourcePath]);

    await service.generate(file!.id);

    expect(modelInput?.studyGoals).toEqual(["Learning goals:\nDefine a Turing machine."]);
    expect(modelInput?.sourceBlocks.map(({ text }) => text.trim())).toEqual([
      "A Turing machine uses a tape and a finite set of internal states."
    ]);
  });

  it("rejects unsupported files, symlinks, and binary text", async () => {
    const unsupportedPath = path.join(root, "payload.html");
    await writeFile(unsupportedPath, "<script />", "utf8");
    await expect(service.registerFiles([unsupportedPath])).rejects.toThrow("Unsupported file type: .html");

    const targetPath = path.join(root, "target.txt");
    const linkPath = path.join(root, "linked.txt");
    await writeFile(targetPath, "private", "utf8");
    await symlink(targetPath, linkPath);
    await expect(service.registerFiles([linkPath])).rejects.toThrow("Regular files only");

    const binaryPath = path.join(root, "binary.txt");
    await writeFile(binaryPath, Buffer.from([0x41, 0x00, 0x42]));
    const [binary] = await service.registerFiles([binaryPath]);
    await expect(service.inspect(binary!.id)).resolves.toMatchObject({
      extraction: { status: "blocked", message: "Binary text file." }
    });
  });

  it("deduplicates files and invalidates IDs on clear", async () => {
    const sourcePath = path.join(root, "notes.txt");
    await writeFile(sourcePath, "one fact", "utf8");
    const [first] = await service.registerFiles([sourcePath]);
    const [second] = await service.registerFiles([sourcePath]);
    expect(second?.id).toBe(first?.id);

    service.clear();
    await expect(service.inspect(first!.id)).rejects.toThrow("File not in session");
  });

  it("cancels active generation when the temporary session is cleared", async () => {
    const sourcePath = path.join(root, "cancel.txt");
    await writeFile(sourcePath, "A temporary source fact.", "utf8");
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const model: LocalNoteModel = {
      generateDocumentNotes: async (_input, signal) => {
        markStarted();
        return await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        });
      }
    };
    service = new DocumentLabService(new DocumentTextExtractor(), model);
    const [file] = await service.registerFiles([sourcePath]);
    const generation = service.generate(file!.id);
    await started;

    service.clear();

    await expect(generation).rejects.toThrow("cancelled");
  });

  it("exposes opaque IDs, never renderer-provided paths, through IPC", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    const [preloadSource, mainSource] = await Promise.all([
      readFile(path.join(repositoryRoot, "electron", "preload.ts"), "utf8"),
      readFile(path.join(repositoryRoot, "electron", "main.ts"), "utf8")
    ]);

    for (const method of ["inspectDocumentLabFile", "generateDocumentLabNotes"]) {
      const line = preloadSource.split("\n").find((candidate) => candidate.includes(`${method}:`));
      expect(line).toContain("(id: string)");
      expect(line).not.toMatch(/\b(filePath|sourcePath|rootPath)\b/);
    }
    for (const channel of ["revember:document-lab-inspect", "revember:document-lab-generate"]) {
      const line = mainSource.split("\n").find((candidate) => candidate.includes(`handleTrusted("${channel}"`));
      expect(line).toContain("id: string");
      expect(line).not.toMatch(/\b(filePath|sourcePath|rootPath)\b/);
    }
  });
});

function docxFixture(text: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      </Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p><w:sectPr/></w:body>
      </w:document>`)
  });
}

function pptxFixture(text: string): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
        <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
      </Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
      </Relationships>`),
    "ppt/presentation.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
      </p:presentation>`),
    "ppt/_rels/presentation.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      </Relationships>`),
    "ppt/slides/slide1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xmlEscape(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
      </p:sld>`)
  });
}

function pdfFixture(text: string): Buffer {
  const safeText = text.replace(/[()\\]/g, (character) => `\\${character}`);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${safeText.length + 34} >>\nstream\nBT /F1 18 Tf 72 720 Td (${safeText}) Tj ET\nendstream`
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "binary");
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
