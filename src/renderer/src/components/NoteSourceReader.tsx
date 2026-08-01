import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  segmentNoteDeterministically,
  type NoteReadingChunk,
  type NoteSourceBlock
} from "../../../../shared/note-segmentation";
import type {
  CaptureReadingChunk,
  CaptureSegmentation,
  LearnerCapture
} from "../../../../shared/types";

export type MaterializedReadingSection = {
  id: string;
  title: string;
  sourceBlockIDs: string[];
  text: string;
};

type NoteSourcePresentation = {
  metadataOnly: boolean;
  topic?: string;
  summary?: string;
};

type NoteSourceReaderProps = {
  capture: LearnerCapture;
  onCreateQuestionFromSection?: (sentence: string) => void;
};

export function NoteSourceReader({ capture, onCreateQuestionFromSection }: NoteSourceReaderProps) {
  const deterministic = useMemo(
    () => segmentNoteDeterministically(capture.rawText),
    [capture.rawText]
  );
  const [segmentation, setSegmentation] = useState<CaptureSegmentation>();
  const [activeSourceBlockID, setActiveSourceBlockID] = useState<string>();
  const [readAll, setReadAll] = useState(false);
  const sectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const outlineRef = useRef<HTMLDetailsElement>(null);
  const focusHeadingAfterNavigation = useRef(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    setSegmentation(undefined);

    if (capture.status !== "ready") {
      return () => {
        alive = false;
      };
    }

    const refresh = async () => {
      try {
        const next = await window.revember.getCaptureSegmentation(capture.id, capture.revision);
        if (!alive) return;
        setSegmentation(next);
        if (next?.status === "queued" || next?.status === "running") {
          timer = window.setTimeout(() => void refresh(), 1_200);
        }
      } catch {
        // Deterministic sections remain available when the derived-record read fails.
      }
    };

    void refresh();
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [capture.id, capture.revision, capture.status]);

  const sections = useMemo(
    () => materializeReadingSections(
      deterministic.blocks,
      deterministic.chunks,
      segmentation?.chunks
    ),
    [deterministic, segmentation?.chunks]
  );

  useEffect(() => {
    const firstBlockID = sections[0]?.sourceBlockIDs[0];
    setActiveSourceBlockID((current) => (
      current && sections.some((section) => section.sourceBlockIDs.includes(current))
        ? current
        : firstBlockID
    ));
    setReadAll(false);
  }, [capture.id, capture.revision]);

  const activeIndex = Math.max(
    0,
    sections.findIndex((section) => (
      activeSourceBlockID ? section.sourceBlockIDs.includes(activeSourceBlockID) : false
    ))
  );
  const activeSection = sections[activeIndex];

  useEffect(() => {
    if (!focusHeadingAfterNavigation.current) return;
    focusHeadingAfterNavigation.current = false;
    sectionHeadingRef.current?.focus();
  }, [activeIndex, readAll, sections]);

  const navigateTo = (index: number) => {
    const next = sections[index];
    if (!next) return;
    focusHeadingAfterNavigation.current = true;
    setReadAll(false);
    setActiveSourceBlockID(next.sourceBlockIDs[0]);
    if (outlineRef.current) outlineRef.current.open = false;
  };

  const toggleReadAll = () => {
    focusHeadingAfterNavigation.current = true;
    setReadAll((current) => !current);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      event.defaultPrevented
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    ) {
      return;
    }
    const target = event.target as HTMLElement;
    if (
      target.closest("input, textarea, select, button, a, summary, [role='button']")
      || target.isContentEditable
      || target.closest("[contenteditable='true']")
    ) {
      return;
    }
    if (readAll) return;

    const nextIndex = event.key === "ArrowLeft" ? activeIndex - 1 : activeIndex + 1;
    if (!sections[nextIndex]) return;
    event.preventDefault();
    navigateTo(nextIndex);
  };

  const displayedTitle = readAll ? "All source" : activeSection?.title ?? "Source";
  const presentation = useMemo(() => presentNoteSource(capture.rawText), [capture.rawText]);
  const displayedText = presentation.metadataOnly
    ? ""
    : readAll
      ? capture.rawText
      : activeSection?.text ?? capture.rawText;

  return (
    <section
      className="note-source note-source-reader"
      aria-labelledby="note-source-section-heading"
      onKeyDown={handleKeyDown}
    >
      {capture.rawText.length > 0 ? (
        <>
          <div className="note-source-reader-toolbar">
            <div className="note-source-progress">
              <span>{readAll ? "All" : `${activeIndex + 1} / ${sections.length}`}</span>
              <h3 id="note-source-section-heading" ref={sectionHeadingRef} tabIndex={-1}>{displayedTitle}</h3>
            </div>
            <div className="note-source-toolbar-actions">
              <button
                className="note-source-read-all"
                type="button"
                data-active={readAll ? "true" : undefined}
                onClick={toggleReadAll}
              >
                {readAll ? "One section" : "Read all"}
              </button>
              <details ref={outlineRef} className="note-source-outline">
                <summary>Jump to section <ChevronDown /></summary>
                <nav aria-label="Source section outline">
                  {sections.map((section, index) => (
                    <button
                      key={section.id}
                      type="button"
                      aria-current={!readAll && index === activeIndex ? "page" : undefined}
                      onClick={() => navigateTo(index)}
                    >
                      <span>{index + 1}</span>
                      <span className="note-source-outline-title">{section.title}</span>
                    </button>
                  ))}
                </nav>
              </details>
            </div>
          </div>

          <div className="note-source-copy">
            {presentation.metadataOnly ? (
              <div className="note-source-metadata" aria-label="Note summary">
                <div className="note-source-metadata-heading">
                  <span>Structured note</span>
                  <strong>Review the summary before creating questions.</strong>
                </div>
                {presentation.topic && <div className="note-source-metadata-row"><span>Topic</span><strong>{presentation.topic}</strong></div>}
                {presentation.summary && <div className="note-source-metadata-row"><span>Summary</span><p>{presentation.summary}</p></div>}
                <p className="note-source-metadata-empty">No original source text was captured for this note.</p>
              </div>
            ) : <div className="note-source-text">{displayedText}</div>}
          </div>

          <div className="note-source-navigation" aria-label="Source section navigation">
            <span>{readAll ? "All source" : `${activeIndex + 1} of ${sections.length}`}</span>
            {!readAll && !presentation.metadataOnly && activeSection?.text.trim() && onCreateQuestionFromSection && (
              <button
                type="button"
                className="note-source-create-question"
                onClick={() => onCreateQuestionFromSection(activeSection.text.trim())}
              >
                <Plus /> Create question from this section
              </button>
            )}
            <button type="button" disabled={readAll || activeIndex === 0} onClick={() => navigateTo(activeIndex - 1)}>
              <ChevronLeft /> Previous
            </button>
            <button type="button" disabled={readAll || activeIndex === sections.length - 1} onClick={() => navigateTo(activeIndex + 1)}>
              Next <ChevronRight />
            </button>
          </div>
        </>
      ) : (
        <div className="note-source-text">This note has no source text yet.</div>
      )}
    </section>
  );
}

function presentNoteSource(rawText: string): NoteSourcePresentation {
  const lines = rawText.replaceAll("\r\n", "\n").split("\n");
  let index = 0;
  let recognized = 0;
  let topic: string | undefined;
  let summary: string | undefined;

  while (index < lines.length) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (line.startsWith("Topic:")) {
      topic = line.slice("Topic:".length).trim() || undefined;
      recognized += 1;
      index += 1;
      continue;
    }
    if (line.startsWith("Summary:")) {
      summary = line.slice("Summary:".length).trim() || undefined;
      recognized += 1;
      index += 1;
      continue;
    }
    if (line === "Concepts:" || line === "Existing review questions:") {
      recognized += 1;
      index += 1;
      while (index < lines.length) {
        const sectionLine = lines[index];
        const sectionText = sectionLine.trim();
        if (!sectionText || sectionLine.startsWith(" ") || sectionLine.startsWith("\t") || sectionText.startsWith("-")) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    break;
  }

  return {
    metadataOnly: recognized >= 2 && !lines.slice(index).some((line) => line.trim()),
    ...(topic ? { topic } : {}),
    ...(summary ? { summary } : {})
  };
}

export function materializeReadingSections(
  blocks: readonly NoteSourceBlock[],
  fallbackChunks: readonly NoteReadingChunk[],
  requestedChunks: readonly CaptureReadingChunk[] | undefined
): MaterializedReadingSection[] {
  const fallback = fallbackChunks.map((chunk, index) => ({
    id: chunk.id,
    title: sectionTitle(undefined, chunk.text, index),
    sourceBlockIDs: [...chunk.sourceBlockIDs],
    text: chunk.text
  }));
  if (!requestedChunks?.length) return fallback;

  const blocksByID = new Map(blocks.map((block) => [block.id, block]));
  const expectedBlockIDs = blocks.map((block) => block.id);
  const requestedBlockIDs = requestedChunks.flatMap((chunk) => chunk.sourceBlockIDs);
  if (
    requestedBlockIDs.length !== expectedBlockIDs.length
    || requestedBlockIDs.some((id, index) => id !== expectedBlockIDs[index])
  ) {
    return fallback;
  }

  const materialized = requestedChunks.map((chunk, index) => {
    const sourceBlocks = chunk.sourceBlockIDs.map((id) => blocksByID.get(id));
    if (sourceBlocks.some((block) => !block)) return undefined;
    const text = sourceBlocks.map((block) => block?.text ?? "").join("");
    return {
      id: chunk.id,
      title: sectionTitle(chunk.title, text, index),
      sourceBlockIDs: [...chunk.sourceBlockIDs],
      text
    };
  });
  return materialized.every((section): section is MaterializedReadingSection => Boolean(section))
    ? materialized
    : fallback;
}

function sectionTitle(title: string | undefined, text: string, index: number): string {
  if (title?.trim()) return title.trim();
  const firstLine = text.split(/\r?\n/u).find((line) => line.trim())?.trim() ?? "";
  const heading = firstLine.match(/^#{1,6}\s+(.+)$/u)?.[1]?.trim();
  if (!heading) return `Section ${index + 1}`;
  return heading.length > 64 ? `${heading.slice(0, 61).trimEnd()}…` : heading;
}
