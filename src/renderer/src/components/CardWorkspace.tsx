import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, Pencil, Play, Plus, Sparkles, X } from "lucide-react";
import type { AppSnapshot, KnowledgeTopic, Question, QuestionDraft, QuestionEdit } from "../../../../shared/types";
import { activeQuestions } from "../../../../shared/domain";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { Eyebrow, Tag } from "./ui";
import { InlineError } from "./review-ui";
import { Modal } from "./modal";
import type { BeforeLeaveGuard } from "../navigationGuard";
import { useBeforeUnloadGuard } from "../hooks/useBeforeUnloadGuard";
import { resolveRevisionConflict, toErrorMessage } from "../utils";

export type CardForm = {
  sentence: string;
  answer: string;
  distractors: Array<{ id: string; text: string }>;
  explanation: string;
};

export function fillGeneratedDistractors(
  existing: CardForm["distractors"],
  generated: readonly string[],
  answer: string
): CardForm["distractors"] {
  const known = new Set([answer, ...existing.map(({ text }) => text)]
    .map(normalizeChoiceText)
    .filter(Boolean));
  const candidates = generated
    .map((text) => text.trim())
    .filter((text) => text && !known.has(normalizeChoiceText(text)))
    .filter((text, index, values) => values.findIndex((value) => normalizeChoiceText(value) === normalizeChoiceText(text)) === index);
  const available = Math.max(0, 3 - existing.filter(({ text }) => text.trim()).length);
  let candidateIndex = 0;
  const filled = existing.map((item) => {
    if (item.text.trim() || candidateIndex >= available) return item;
    const text = candidates[candidateIndex++];
    return text ? { ...item, text } : item;
  });
  while (candidateIndex < available && candidateIndex < candidates.length) {
    const number = filled.length + 1;
    filled.push({ id: `choice-distractor-${number}`, text: candidates[candidateIndex++]! });
  }
  return filled;
}

export function replaceGeneratedDistractors(
  existing: CardForm["distractors"],
  generated: readonly string[],
  answer: string
): CardForm["distractors"] {
  const candidates = generated
    .map((text) => text.trim())
    .filter((text) => text && normalizeChoiceText(text) !== normalizeChoiceText(answer))
    .filter((text, index, values) => values.findIndex((value) => normalizeChoiceText(value) === normalizeChoiceText(text)) === index);
  if (candidates.length < existing.length) return existing;
  return existing.map((item, index) => ({ ...item, text: candidates[index]! }));
}

function normalizeChoiceText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

const CARD_CONFLICT_MESSAGE =
  "This topic changed somewhere else. Reload it, then reopen the question and try again; your form is still here.";

function initialForm(question?: Question, seedSentence?: string): CardForm {
  const correct = question?.choices.find((choice) => choice.isCorrect);
  return {
    sentence: seedSentence ?? (question && correct ? question.prompt.replace("________", correct.text) : question?.prompt ?? ""),
    answer: correct?.text ?? "",
    distractors: question
      ? question.choices.filter((choice) => !choice.isCorrect).map((choice) => ({ id: choice.id, text: choice.text }))
      : [{ id: "choice-distractor-1", text: "" }],
    explanation: question?.explanation ?? ""
  };
}

export function buildExistingCardEdit(
  question: Question,
  initial: CardForm,
  form: CardForm,
  storedPrompt: string
): QuestionEdit | undefined {
  const correctChoiceID = question.choices.find((choice) => choice.isCorrect)?.id;
  const editedChoiceText = new Map([
    ...(correctChoiceID ? [[correctChoiceID, form.answer.trim()] as const] : []),
    ...form.distractors.map((choice) => [choice.id, choice.text.trim()] as const)
  ]);
  const current = questionEditFrom(question);
  const edit: QuestionEdit = {
    ...current,
    prompt: storedPrompt,
    conceptIDs: question.conceptIDs,
    choices: question.choices.map((choice) => ({
      ...choice,
      text: editedChoiceText.get(choice.id) ?? choice.text
    })),
    explanation: form.explanation.trim()
  };
  return JSON.stringify(edit) === JSON.stringify(current) ? undefined : edit;
}

function questionEditFrom(question: Question): QuestionEdit {
  return {
    kind: question.kind,
    transferLevel: question.transferLevel,
    prompt: question.prompt,
    difficulty: question.difficulty,
    conceptIDs: question.conceptIDs,
    gapTags: question.gapTags,
    sourceRefs: question.sourceRefs,
    choices: question.choices,
    explanation: question.explanation
  };
}

export function storedPromptForCard(question: Question | undefined, sentence: string, answer: string): string {
  const prompt = sentence.trim();
  const trimmedAnswer = answer.trim();
  if (question && !question.prompt.includes("________")) return prompt;
  return trimmedAnswer ? prompt.replace(trimmedAnswer, "________") : prompt;
}

type CardWorkspaceProps = {
  topic: KnowledgeTopic;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onReview: (question: Question) => void;
  onRegisterBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
  seedSentence?: string;
  seedToken?: string;
  onSeedConsumed: () => void;
};

export function CardWorkspace({
  topic,
  onSnapshot,
  onReview,
  onRegisterBeforeLeave,
  seedSentence,
  seedToken,
  onSeedConsumed
}: CardWorkspaceProps) {
  const [editing, setEditing] = useState<Question>();
  const [creating, setCreating] = useState(false);
  const [retiring, setRetiring] = useState<Question>();
  const [savedQuestion, setSavedQuestion] = useState<Question>();
  const [createSeed, setCreateSeed] = useState<string>();
  const consumedSeedToken = useRef<string | undefined>(undefined);

  const startCreating = () => {
    setSavedQuestion(undefined);
    setCreateSeed(undefined);
    setEditing(undefined);
    setCreating(true);
  };

  const startEditing = (question: Question) => {
    setCreating(false);
    setEditing(question);
  };

  const closeEditor = () => {
    setCreateSeed(undefined);
    setCreating(false);
    setEditing(undefined);
  };

  const handleQuestionSaved = (question: Question) => {
    closeEditor();
    setSavedQuestion(question);
  };

  useEffect(() => {
    if (!seedToken || consumedSeedToken.current === seedToken) return;
    consumedSeedToken.current = seedToken;
    setEditing(undefined);
    setCreateSeed(seedSentence);
    setCreating(true);
    onSeedConsumed();
  }, [onSeedConsumed, seedSentence, seedToken]);

  const active = activeQuestions(topic);
  const retired = topic.questions.filter((question) => question.retiredAt);

  return (
    <section className="cards-workspace" aria-labelledby="cards-heading">
      <header className="cards-heading">
        <div>
          <Eyebrow>{active.length} {active.length === 1 ? "question" : "questions"} in this topic</Eyebrow>
          <h2 id="cards-heading">Questions</h2>
          <p>Build a small, reliable question bank from the ideas you want to remember.</p>
        </div>
        <button className="primary" onClick={startCreating}><Plus /> New question</button>
      </header>

      {active.length ? (
        <div className="cards-list">
          {active.map((question, index) => (
            <article className="surface authored-card" key={question.id}>
              <div className="authored-card-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="authored-card-copy">
                <Eyebrow>{question.revision > 1 ? `Revision ${question.revision}` : "Question"}</Eyebrow>
                <h3>{question.prompt}</h3>
                <div className="authored-card-concepts">
                  {question.conceptIDs.map((id) => (
                    <Tag key={id}>{topic.concepts.find((concept) => concept.id === id)?.title ?? id}</Tag>
                  ))}
                </div>
              </div>
              <div className="card-actions">
                <button type="button" onClick={() => onReview(question)}><Play /> Review</button>
                <button type="button" onClick={() => startEditing(question)}><Pencil /> Edit</button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => setRetiring(question)}
                  aria-label={`Archive ${question.prompt}`}
                  title="Archive question"
                >
                  <Archive />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="surface cards-empty">
          <Check />
          <h3>No questions yet</h3>
          <p>Add the first question for this topic. It will enter the normal review queue after you save it.</p>
          <button className="primary" onClick={startCreating}><Plus /> Create first question</button>
        </div>
      )}

      {retired.length > 0 && (
        <details className="retired-cards">
          <summary>{retired.length} archived {retired.length === 1 ? "question" : "questions"}</summary>
          <ul>{retired.map((question) => <li key={question.id}>{question.prompt}</li>)}</ul>
        </details>
      )}

      {(creating || editing) && (
        <CardEditor
          topic={topic}
          question={editing}
          seedSentence={creating ? createSeed : undefined}
          onSnapshot={onSnapshot}
          onClose={closeEditor}
          onSaved={handleQuestionSaved}
          onRegisterBeforeLeave={onRegisterBeforeLeave}
        />
      )}
      {retiring && (
        <ArchiveCardDialog
          topic={topic}
          question={retiring}
          onSnapshot={onSnapshot}
          onClose={() => setRetiring(undefined)}
        />
      )}
      {savedQuestion && (
        <QuestionSavedToast
          onClose={() => setSavedQuestion(undefined)}
          onCreateAnother={startCreating}
        />
      )}
    </section>
  );
}

function QuestionSavedToast({ onClose, onCreateAnother }: {
  onClose: () => void;
  onCreateAnother: () => void;
}) {
  return (
    <aside className="question-saved-toast" role="status" aria-live="polite">
      <Check aria-hidden="true" />
      <div className="question-saved-toast-copy">
        <strong>Question saved</strong>
        <span>Ready for your next review.</span>
      </div>
      <span className="question-saved-toast-divider" aria-hidden="true" />
      <button className="question-saved-toast-create" type="button" onClick={onCreateAnother}>Create another</button>
      <button className="question-saved-toast-dismiss" type="button" aria-label="Dismiss saved notification" onClick={onClose}><X /></button>
    </aside>
  );
}

function CardEditor({ topic, question, seedSentence, onSnapshot, onClose, onSaved, onRegisterBeforeLeave }: {
  topic: KnowledgeTopic;
  question?: Question;
  seedSentence?: string;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onClose: () => void;
  onSaved: (question: Question) => void;
  onRegisterBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
}) {
  const [initial] = useState<CardForm>(() => initialForm(question, seedSentence));
  const [form, setForm] = useState<CardForm>(initial);
  const [error, setError] = useState<string>();
  const [distractorError, setDistractorError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [generatingDistractors, setGeneratingDistractors] = useState(false);
  const [generatedDistractors, setGeneratedDistractors] = useState(false);
  const pendingStoredPrompt = storedPromptForCard(question, form.sentence, form.answer);
  const pendingExistingEdit = question
    ? buildExistingCardEdit(question, initial, form, pendingStoredPrompt)
    : undefined;
  const dirty = question
    ? Boolean(pendingExistingEdit)
    : JSON.stringify(form) !== JSON.stringify(initial);
  useBeforeUnloadGuard(dirty);
  const confirmDiscard = useCallback(
    () => !dirty || window.confirm("Discard your unsaved question changes?"),
    [dirty]
  );
  const requestClose = useCallback(() => {
    if (confirmDiscard()) onClose();
  }, [confirmDiscard, onClose]);
  useEffect(() => {
    onRegisterBeforeLeave(dirty ? confirmDiscard : undefined);
    return () => onRegisterBeforeLeave(undefined);
  }, [confirmDiscard, dirty, onRegisterBeforeLeave]);
  const sentenceIncludesAnswer = form.answer.trim() && form.sentence.includes(form.answer.trim());
  const cardID = useMemo(() => `card-${crypto.randomUUID()}`, []);
  const correctChoiceID = question?.choices.find((choice) => choice.isCorrect)?.id ?? "choice-correct";
  const update = <K extends keyof CardForm>(key: K, value: CardForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const updateDistractor = (id: string, text: string) => update("distractors", form.distractors.map((item) => item.id === id ? { ...item, text } : item));
  const addDistractor = () => update("distractors", [...form.distractors, { id: `choice-distractor-${form.distractors.length + 1}`, text: "" }]);
  const populatedDistractors = form.distractors.filter(({ text }) => text.trim()).length;

  const generateDistractors = async () => {
    if (!form.sentence.trim() || !form.answer.trim()) {
      setDistractorError("Add the sentence and answer first so the local model has enough context.");
      return;
    }
    try {
      setGeneratingDistractors(true);
      setDistractorError(undefined);
      const generated = await window.revember.generateDistractors({
        topicID: topic.id,
        sentence: form.sentence.trim(),
        answer: form.answer.trim()
      });
      const next = question
        ? replaceGeneratedDistractors(form.distractors, generated, form.answer)
        : fillGeneratedDistractors(form.distractors, generated, form.answer);
      if (!next.some((item, index) => normalizeChoiceText(item.text) !== normalizeChoiceText(form.distractors[index]?.text ?? ""))) {
        setDistractorError("The local model did not return usable new distractors. Try again or edit the options yourself.");
        return;
      }
      update("distractors", next);
      setGeneratedDistractors(true);
    } catch (cause) {
      setDistractorError(toErrorMessage(cause));
    } finally {
      setGeneratingDistractors(false);
    }
  };

  const save = async () => {
    const answer = form.answer.trim();
    const prompt = form.sentence.trim();
    const choices = [{ id: correctChoiceID, text: answer, isCorrect: true }, ...form.distractors.map((item) => ({ id: item.id, text: item.text.trim(), isCorrect: false }))];
    if (!prompt || !answer || !form.explanation.trim() || choices.some((choice) => !choice.text)) {
      setError("Add a sentence, answer, at least one distractor, and an explanation."); return;
    }
    const answerOccurrences = form.sentence.split(answer).length - 1;
    if ((!question || question.prompt.includes("________")) && answerOccurrences !== 1) {
      setError("Use the answer exactly once in the sentence. This keeps the blank unambiguous."); return;
    }
    const storedPrompt = storedPromptForCard(question, prompt, answer);
    const existingEdit = question ? buildExistingCardEdit(question, initial, form, storedPrompt) : undefined;
    if (question && !existingEdit) return;
    const newCard = {
      kind: "multipleChoice" as const,
      transferLevel: "recall" as const,
      prompt: storedPrompt,
      difficulty: "intro" as const,
      conceptIDs: [],
      gapTags: [],
      sourceRefs: [],
      choices,
      explanation: form.explanation.trim()
    };
    try {
      setSaving(true); setError(undefined);
      const result = question
        ? await window.revember.editCard({
            topicID: topic.id,
            expectedTopicRevision: topic.revision,
            questionID: question.id,
            expectedQuestionRevision: question.revision,
            card: existingEdit!
          })
        : await window.revember.createCard({ topicID: topic.id, expectedTopicRevision: topic.revision, card: { id: cardID, ...newCard } satisfies QuestionDraft });
      onSnapshot(result.snapshot);
      setSaving(false);
      onSaved(result.question);
    } catch (cause) {
      setError(resolveRevisionConflict(cause, CARD_CONFLICT_MESSAGE).message);
      setSaving(false);
    }
  };

  return (
    <Modal
      title={question ? "Edit question" : "Create question"}
      icon={<Pencil />}
      className="card-editor-dialog"
      closeOnBackdrop={false}
      onClose={requestClose}
    >
      <form className="card-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="card-editor-field card-editor-question-field">
            <span>Sentence containing the answer</span>
            <textarea autoFocus value={form.sentence} onChange={(event) => update("sentence", event.target.value)} placeholder="For example: A bit is a distinguishable physical state." />
          </label>
          <section className="card-editor-answer-panel" aria-label="Answer details">
            <label className="card-editor-field">
              <span>Answer</span>
              <input value={form.answer} onChange={(event) => update("answer", event.target.value)} placeholder="A bit" />
              <small>{question ? "Editing keeps the current answer structure." : sentenceIncludesAnswer ? "The answer appears in the sentence and will be shown as a blank during review." : "Use the exact answer once in the sentence."}</small>
            </label>
          </section>
          <fieldset className="card-editor-distractors">
            <legend>Distractors</legend>
            {form.distractors.map((item, index) => (
              <label className="card-editor-field" key={item.id}>
                <span>Alternative {index + 1}</span>
                <input value={item.text} onChange={(event) => updateDistractor(item.id, event.target.value)} placeholder="A plausible but incorrect answer" />
              </label>
            ))}
            {!question && form.distractors.length < 3 && <button type="button" className="text-button" onClick={addDistractor}><Plus /> Add distractor</button>}
            <div className="distractor-assist">
              <div>{question
                ? <><strong>Replace current options?</strong><small>Generate comparable wrong answers locally. Saving creates a new question revision.</small></>
                : <><strong>Need suggestions?</strong><small>Generate up to three comparable wrong answers locally. Your existing options stay untouched.</small></>
              }</div>
              <button type="button" className="local-assist-button" disabled={generatingDistractors || (!question && populatedDistractors >= 3)} onClick={() => void generateDistractors()}><Sparkles /> {generatingDistractors ? "Generating…" : question ? "Replace distractors" : "Generate distractors"}</button>
            </div>
            {generatedDistractors && <p className="distractor-generation-note"><Sparkles /> {question ? "New options generated locally. Review them, then save this revision." : "Generated locally. Review every option before saving."}</p>}
            {distractorError && <InlineError message={distractorError} />}
            {question && <small>Saving keeps this as the same question, updated as a new revision.</small>}
          </fieldset>
          <label className="card-editor-field card-editor-explanation-field">
            <span>Explanation</span>
            <textarea value={form.explanation} onChange={(event) => update("explanation", event.target.value)} placeholder="Why is this answer correct?" />
          </label>
          {error && <InlineError message={error} />}
          <div className="dialog-footer card-editor-footer">
            <button type="button" onClick={requestClose}>Cancel</button>
            <button className="primary" disabled={saving || generatingDistractors || Boolean(question && !pendingExistingEdit)} type="submit">{saving ? "Saving…" : "Save question"}</button>
          </div>
      </form>
    </Modal>
  );
}

function ArchiveCardDialog({ topic, question, onSnapshot, onClose }: { topic: KnowledgeTopic; question: Question; onSnapshot: (snapshot: AppSnapshot) => void; onClose: () => void }) {
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const archive = async () => {
    try {
      setSaving(true);
      const result = await window.revember.retireCard({
        topicID: topic.id,
        expectedTopicRevision: topic.revision,
        questionID: question.id,
        expectedQuestionRevision: question.revision
      });
      onSnapshot(result.snapshot);
      onClose();
    } catch (cause) {
      setError(resolveRevisionConflict(cause, CARD_CONFLICT_MESSAGE).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmationDialog
      title="Archive question"
      icon={<Archive />}
      confirmLabel="Archive question"
      pendingLabel="Archiving…"
      isConfirming={saving}
      error={error}
      onConfirm={() => void archive()}
      onClose={onClose}
    >
      <p>Archive this question? It will no longer appear in active review, while its past evidence stays readable.</p>
      <strong>{question.prompt}</strong>
    </ConfirmationDialog>
  );
}
