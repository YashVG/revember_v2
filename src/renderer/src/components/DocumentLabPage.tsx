import { useEffect, useMemo, useState } from "react";
import {
  Beaker,
  Check,
  CircleAlert,
  FileText,
  ScanText,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import type {
  DocumentLabFile,
  DocumentLabGeneration,
  DocumentLabGroundedText,
  DocumentLabInspection
} from "../../../../shared/types";
import { toErrorMessage } from "../utils";

export function DocumentLabPage() {
  const [files, setFiles] = useState<DocumentLabFile[]>([]);
  const [selectedID, setSelectedID] = useState<string>();
  const [inspection, setInspection] = useState<DocumentLabInspection>();
  const [generation, setGeneration] = useState<DocumentLabGeneration>();
  const [busy, setBusy] = useState<"choose" | "inspect" | "generate" | "clear">();
  const [error, setError] = useState<string>();

  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedID),
    [files, selectedID]
  );

  useEffect(() => () => {
    void window.revember.clearDocumentLabSession();
  }, []);

  const chooseFiles = async () => {
    setBusy("choose");
    setError(undefined);
    try {
      const added = await window.revember.chooseDocumentLabFiles();
      if (added.length === 0) return;
      setFiles((current) => {
        const next = new Map(current.map((file) => [file.id, file]));
        for (const file of added) next.set(file.id, file);
        return [...next.values()];
      });
      setSelectedID((current) => current ?? added[0]?.id);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  };

  const inspectSelected = async () => {
    if (!selectedFile) return;
    setBusy("inspect");
    setError(undefined);
    try {
      setInspection(await window.revember.inspectDocumentLabFile(selectedFile.id));
      setGeneration(undefined);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  };

  const generateNotes = async () => {
    if (!selectedFile) return;
    setBusy("generate");
    setError(undefined);
    try {
      const next = await window.revember.generateDocumentLabNotes(selectedFile.id);
      setInspection({ file: next.file, extraction: next.extraction });
      setGeneration(next);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  };

  const clearSession = async () => {
    setBusy("clear");
    setError(undefined);
    try {
      await window.revember.clearDocumentLabSession();
      setFiles([]);
      setSelectedID(undefined);
      setInspection(undefined);
      setGeneration(undefined);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(undefined);
    }
  };

  const selectFile = (id: string) => {
    setSelectedID(id);
    setInspection((current) => current?.file.id === id ? current : undefined);
    setGeneration((current) => current?.file.id === id ? current : undefined);
    setError(undefined);
  };

  return (
    <section className="document-lab-page" aria-labelledby="document-lab-title">
      <header className="document-lab-header">
        <div>
          <div className="document-lab-kicker"><Beaker /> Test</div>
          <h1 id="document-lab-title">Document Lab</h1>
          <p>Study notes from documents.</p>
        </div>
        <div className="document-lab-header-actions">
          {files.length > 0 && <button
            type="button"
            className="document-lab-clear"
            disabled={Boolean(busy)}
            onClick={() => void clearSession()}
          ><Trash2 /> Clear</button>}
          <button
            type="button"
            className="primary"
            disabled={Boolean(busy)}
            onClick={() => void chooseFiles()}
          ><Upload /> {busy === "choose" ? "Opening…" : "Add files"}</button>
        </div>
      </header>

      <div className="document-lab-boundary" role="note">
        <CircleAlert />
        <p><strong>Session only.</strong> Nothing is saved.</p>
      </div>

      {error && <div className="document-lab-error" role="alert"><CircleAlert />{error}</div>}

      <div className="document-lab-workspace">
        <aside className="document-lab-queue" aria-label="Test documents">
          <div className="document-lab-section-heading">
            <h2>Files</h2>
            <span>{files.length} / 12</span>
          </div>
          {files.length === 0 ? (
            <button type="button" className="document-lab-empty-queue" onClick={() => void chooseFiles()}>
              <Upload />
              <strong>Add files</strong>
              <span>TXT · MD · PDF · DOCX · PPTX</span>
            </button>
          ) : (
            <div className="document-lab-file-list">
              {files.map((file) => <button
                type="button"
                key={file.id}
                className={`document-lab-file ${selectedID === file.id ? "selected" : ""}`}
                aria-pressed={selectedID === file.id}
                onClick={() => selectFile(file.id)}
              >
                <span className="document-lab-file-icon"><FileText /></span>
                <span className="document-lab-file-copy">
                  <strong>{file.name}</strong>
                  <small>{file.extension.toUpperCase()} · {formatBytes(file.sizeBytes)}</small>
                </span>
              </button>)}
            </div>
          )}
        </aside>

        <section className="document-lab-inspector" aria-label="Document pipeline inspector">
          {!selectedFile ? (
            <div className="document-lab-inspector-empty">
              <Beaker />
              <h2>Add a file</h2>
            </div>
          ) : (
            <>
              <div className="document-lab-selected-heading">
                <div>
                  <h2>{selectedFile.name}</h2>
                  <p>{kindLabel(selectedFile.kind)} · {formatBytes(selectedFile.sizeBytes)}</p>
                </div>
                <button
                  type="button"
                  className="primary"
                  disabled={Boolean(busy)}
                  onClick={() => void (
                    inspection?.extraction.status === "extracted"
                      ? generateNotes()
                      : inspectSelected()
                  )}
                >{inspection?.extraction.status === "extracted" ? <Sparkles /> : <ScanText />} {primaryActionLabel(busy, inspection, generation)}</button>
              </div>

              <div className="document-lab-pipeline" aria-label="Processing stages">
                <PipelineStage
                  number="01"
                  title="Extract"
                  detail={extractionStageDetail(inspection)}
                  state={extractionStageState(inspection)}
                  icon={inspection?.extraction.status === "extracted" ? <Check /> : <ScanText />}
                />
                <PipelineStage
                  number="02"
                  title="Filter"
                  detail={generation ? `${noteCount(generation)} notes` : ""}
                  state={generation ? "complete" : inspection?.extraction.status === "extracted" ? "ready" : "not-connected"}
                  icon={generation ? <Check /> : <FileText />}
                />
                <PipelineStage
                  number="03"
                  title="Notes"
                  detail={generation ? `${generation.draft.sections.length} sections` : ""}
                  state={generation ? "complete" : "not-connected"}
                  icon={generation ? <Check /> : <Sparkles />}
                />
              </div>

              {generation ? (
                <GeneratedNotes generation={generation} />
              ) : !inspection ? (
                <div className="document-lab-ready-state">
                  <ScanText />
                  <h3>Ready</h3>
                  <p>Extract the selected file.</p>
                </div>
              ) : (
                <div className={`document-lab-result ${inspection.extraction.status}`}>
                  <div className="document-lab-result-heading">
                    <h3>{inspection.extraction.status === "extracted" ? "Preview" : "Blocked"}</h3>
                  </div>
                  {inspection.extraction.status !== "extracted" && <p>{inspection.extraction.message}</p>}
                  {inspection.extraction.status === "extracted" && <>
                    <div className="document-lab-preview-meta">
                      <span>{inspection.extraction.previewCharacterCount?.toLocaleString() ?? 0} chars</span>
                      <span>{inspection.extraction.previewLineCount?.toLocaleString() ?? 0} lines</span>
                      {inspection.extraction.previewTruncated && <span>truncated</span>}
                    </div>
                    <pre className="document-lab-preview">{inspection.extraction.textPreview || "The file is empty."}</pre>
                  </>}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function GeneratedNotes({ generation }: { generation: DocumentLabGeneration }) {
  return <div className="document-lab-generated">
    <div className="document-lab-generated-heading">
      <h3>{generation.draft.title}</h3>
      <span>{generation.draft.model}</span>
    </div>
    <section>
      <h4>Notes</h4>
      <div className="document-lab-note-sections">
        {generation.draft.sections.map((section, sectionIndex) => <article key={`${sectionIndex}:${section.title}`}>
          <h5>{section.title}</h5>
          <ul>{section.bullets.map((bullet, bulletIndex) => <li key={`${bulletIndex}:${bullet.text}`}>
            <GroundedText item={bullet} />
          </li>)}</ul>
        </article>)}
      </div>
    </section>
  </div>;
}

function noteCount(generation: DocumentLabGeneration): number {
  return generation.draft.sections.reduce((count, section) => count + section.bullets.length, 0);
}

function GroundedText({ item }: { item: DocumentLabGroundedText }) {
  return <>
    <span>{item.text}</span>
    <details>
      <summary>Source</summary>
      {item.evidence.map((evidence, index) => <blockquote key={`${index}:${evidence}`}>{evidence}</blockquote>)}
    </details>
  </>;
}

function PipelineStage({ number, title, detail, state, icon }: {
  number: string;
  title: string;
  detail: string;
  state: "ready" | "complete" | "blocked" | "adapter-required" | "not-connected";
  icon: React.ReactNode;
}) {
  return <article className={`document-lab-stage ${state}`}>
    <div className="document-lab-stage-icon">{icon}</div>
    <div>
      <span>{number}</span>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
    </div>
    <small>{stageLabel(state)}</small>
  </article>;
}

function extractionStageState(inspection?: DocumentLabInspection): "ready" | "complete" | "blocked" | "adapter-required" {
  if (!inspection) return "ready";
  if (inspection.extraction.status === "extracted") return "complete";
  return inspection.extraction.status;
}

function extractionStageDetail(inspection?: DocumentLabInspection): string {
  if (!inspection || inspection.extraction.status === "extracted") return "";
  return inspection.extraction.message;
}

function stageLabel(state: "ready" | "complete" | "blocked" | "adapter-required" | "not-connected"): string {
  if (state === "adapter-required") return "Blocked";
  if (state === "not-connected") return "Waiting";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function primaryActionLabel(
  busy: "choose" | "inspect" | "generate" | "clear" | undefined,
  inspection: DocumentLabInspection | undefined,
  generation: DocumentLabGeneration | undefined
): string {
  if (busy === "inspect") return "Extracting…";
  if (busy === "generate") return "Generating…";
  if (generation) return "Regenerate";
  if (inspection?.extraction.status === "extracted") return "Generate";
  return "Extract";
}

function kindLabel(kind: DocumentLabFile["kind"]): string {
  switch (kind) {
    case "markdown": return "Markdown";
    case "pdf": return "PDF";
    case "word": return "Word";
    case "slides": return "Slides";
    default: return "Text";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
