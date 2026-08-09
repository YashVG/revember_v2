import { randomUUID } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { splitNoteIntoSourceBlocks } from "../shared/note-segmentation";
import type {
  DocumentLabDraft,
  DocumentLabExtraction,
  DocumentLabFile,
  DocumentLabFileKind,
  DocumentLabGeneration,
  DocumentLabGroundedText,
  DocumentLabInspection
} from "../shared/types";
import {
  DocumentTextExtractor,
  type DocumentTextExtraction
} from "./document-text-extractor";
import {
  localOllamaModel,
  OllamaNoteModel,
  type GeneratedDocumentNotes,
  type LocalNoteModel
} from "./ollama-note-model";

const MAX_DOCUMENTS_PER_SELECTION = 12;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_PREVIEW_CHARACTERS = 60_000;
const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const KIND_BY_EXTENSION: Readonly<Record<string, DocumentLabFileKind>> = {
  ".txt": "text",
  ".md": "markdown",
  ".pdf": "pdf",
  ".docx": "word",
  ".pptx": "slides"
};

interface RegisteredDocument {
  sourcePath: string;
  file: DocumentLabFile;
  extraction?: DocumentTextExtraction;
}

export class DocumentLabService {
  private readonly documents = new Map<string, RegisteredDocument>();
  private readonly idByPath = new Map<string, string>();
  private readonly activeOperations = new Map<string, AbortController>();

  constructor(
    private readonly extractor: DocumentTextExtractor = new DocumentTextExtractor(),
    private readonly model: LocalNoteModel = new OllamaNoteModel()
  ) {}

  async registerFiles(sourcePaths: readonly string[]): Promise<DocumentLabFile[]> {
    if (!Array.isArray(sourcePaths) || sourcePaths.length > MAX_DOCUMENTS_PER_SELECTION) {
      throw new Error(`Choose no more than ${MAX_DOCUMENTS_PER_SELECTION} files.`);
    }

    const files: DocumentLabFile[] = [];
    for (const rawPath of sourcePaths) {
      if (typeof rawPath !== "string" || rawPath.length === 0 || rawPath.length > 4096) {
        throw new Error("Invalid file path.");
      }

      const sourcePath = path.resolve(rawPath);
      const extension = path.extname(sourcePath).toLowerCase();
      const kind = KIND_BY_EXTENSION[extension];
      if (!kind) throw new Error(`Unsupported file type: ${extension || "none"}.`);

      const sourceStat = await lstat(sourcePath);
      if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
        throw new Error("Regular files only.");
      }
      if (sourceStat.size > MAX_DOCUMENT_BYTES) {
        throw new Error(`${path.basename(sourcePath)} exceeds 50 MB.`);
      }

      const existingID = this.idByPath.get(sourcePath);
      const existing = existingID ? this.documents.get(existingID) : undefined;
      if (existing) {
        files.push(existing.file);
        continue;
      }

      const file: DocumentLabFile = {
        id: randomUUID(),
        name: path.basename(sourcePath),
        extension: extension.slice(1),
        kind,
        sizeBytes: sourceStat.size,
        modifiedAt: sourceStat.mtime.toISOString()
      };
      this.documents.set(file.id, { sourcePath, file });
      this.idByPath.set(sourcePath, file.id);
      files.push(file);
    }
    return files;
  }

  async inspect(id: string): Promise<DocumentLabInspection> {
    const document = this.getDocument(id);
    return this.runOperation(id, async (signal) => {
      const extraction = await this.extractDocument(document, signal);
      return {
        file: document.file,
        extraction: publicExtraction(extraction)
      };
    });
  }

  async generate(id: string): Promise<DocumentLabGeneration> {
    const document = this.getDocument(id);
    return this.runOperation(id, async (signal) => {
      const extraction = await this.extractDocument(document, signal);
      if (extraction.status !== "extracted") throw new Error(extraction.message);

      const extractedSourceBlocks = extraction.sourceBlocks ?? splitNoteIntoSourceBlocks(extraction.text)
        .filter(({ kind }) => kind !== "whitespace")
        .map(({ id: sourceID, text }) => ({ id: sourceID, text }));
      const { sourceBlocks, studyGoals } = prepareStudyMaterial(extractedSourceBlocks);
      if (sourceBlocks.length === 0) throw new Error("No study content found in this document.");
      const generateDocumentNotes = this.model.generateDocumentNotes;
      if (!generateDocumentNotes) throw new Error("Local generation unavailable.");

      const generated = await generateDocumentNotes.call(this.model, {
        title: path.basename(document.file.name, path.extname(document.file.name)),
        studyGoals,
        sourceBlocks
      }, signal);
      return {
        file: document.file,
        extraction: publicExtraction(extraction),
        draft: materializeDraft(document.file, generated, sourceBlocks)
      };
    });
  }

  clear(): void {
    for (const controller of this.activeOperations.values()) controller.abort();
    this.activeOperations.clear();
    this.documents.clear();
    this.idByPath.clear();
  }

  private async extractDocument(
    document: RegisteredDocument,
    signal: AbortSignal
  ): Promise<DocumentTextExtraction> {
    if (document.extraction) return document.extraction;

    const sourceStat = await lstat(document.sourcePath);
    if (
      sourceStat.isSymbolicLink()
      || !sourceStat.isFile()
      || sourceStat.size !== document.file.sizeBytes
      || sourceStat.mtime.toISOString() !== document.file.modifiedAt
    ) {
      throw new Error("File changed. Add it again.");
    }

    const handle = await open(document.sourcePath, "r");
    try {
      const bytes = await handle.readFile();
      if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error("File exceeds 50 MB.");
      const extraction = await this.extractor.extract(bytes, document.file.kind, signal);
      if (!signal.aborted) document.extraction = extraction;
      return extraction;
    } finally {
      await handle.close();
    }
  }

  private async runOperation<T>(
    id: string,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    this.activeOperations.get(id)?.abort();
    const controller = new AbortController();
    this.activeOperations.set(id, controller);
    try {
      return await operation(controller.signal);
    } finally {
      if (this.activeOperations.get(id) === controller) this.activeOperations.delete(id);
    }
  }

  private getDocument(id: string): RegisteredDocument {
    if (typeof id !== "string" || !DOCUMENT_ID_PATTERN.test(id)) {
      throw new Error("Invalid session ID.");
    }
    const document = this.documents.get(id);
    if (!document) throw new Error("File not in session.");
    return document;
  }
}

function prepareStudyMaterial(
  sourceBlocks: ReadonlyArray<{ id: string; text: string }>
): {
  sourceBlocks: Array<{ id: string; text: string }>;
  studyGoals: string[];
} {
  const content: Array<{ id: string; text: string }> = [];
  const studyGoals: string[] = [];
  const groups = new Map<string, Array<{ id: string; text: string }>>();

  for (const block of sourceBlocks) {
    const groupID = block.id.replace(/-part-\d+$/u, "");
    const group = groups.get(groupID) ?? [];
    group.push(block);
    groups.set(groupID, group);
  }

  for (const group of groups.values()) {
    const text = group.map((block) => block.text.trim()).filter(Boolean).join("\n");
    if (!text || isCourseAdministration(text) || isCourseTitle(text)) continue;
    if (isStudyScope(text)) {
      studyGoals.push(text);
      continue;
    }
    content.push(...group);
  }
  return { sourceBlocks: content, studyGoals: studyGoals.slice(0, 12) };
}

function isStudyScope(text: string): boolean {
  return /\b(?:learning goals?|lecture objectives?|aims? of (?:the rest of )?(?:today[’']s )?lecture)\b/i.test(text);
}

function isCourseAdministration(text: string): boolean {
  return [
    /\boverall goal of the course\b/i,
    /\bby the end of the course\b/i,
    /\bgeneral course organi[sz]ation\b/i,
    /\b(?:written exams?|final grade|attendance|marked labs?|marks? each|survey questions?)\b/i,
    /\b(?:learning resources?|office hours?|contact information|course TAs?)\b/i,
    /\b(?:classroom|group assignments?|uploaded? to canvas|miss a lab)\b/i,
    /\b(?:use jupyter|install .*python|programming environment|connected to the internet)\b/i,
    /\bmaterial to be covered in this course\b/i,
    /\bplease try and find time to read\b/i
  ].some((pattern) => pattern.test(text));
}

function isCourseTitle(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return text.length < 160
    && words.length < 12
    && /\b[A-Z]{2,8}\s*\d{3}\b/u.test(text)
    && !/[.!?;→=]/u.test(text);
}

function publicExtraction(extraction: DocumentTextExtraction): DocumentLabExtraction {
  if (extraction.status === "blocked") {
    return {
      status: "blocked",
      message: extraction.message
    };
  }
  const textPreview = extraction.text.slice(0, MAX_TEXT_PREVIEW_CHARACTERS);
  const previewTruncated = extraction.truncated || textPreview.length < extraction.text.length;
  return {
    status: "extracted",
    textPreview,
    previewCharacterCount: textPreview.length,
    previewLineCount: textPreview.split("\n").length,
    previewTruncated,
    message: previewTruncated ? "Extracted · preview truncated." : "Extracted."
  };
}

function materializeDraft(
  file: DocumentLabFile,
  generated: GeneratedDocumentNotes,
  sourceBlocks: ReadonlyArray<{ id: string; text: string }>
): DocumentLabDraft {
  const sourceTextByID = new Map(sourceBlocks.map(({ id, text }) => [id, text.trim()]));
  const ground = (item: { text: string; sourceBlockIDs: string[] }): DocumentLabGroundedText => ({
    text: item.text,
    evidence: item.sourceBlockIDs.map((sourceID) => {
      const evidence = sourceTextByID.get(sourceID);
      if (evidence === undefined) throw new Error("Generated source ID is invalid.");
      return evidence;
    })
  });
  return {
    title: path.basename(file.name, path.extname(file.name)),
    model: localOllamaModel,
    sourceBlockCount: sourceBlocks.length,
    sections: generated.sections.map((section) => ({
      title: section.title,
      bullets: section.bullets.map(ground)
    }))
  };
}
