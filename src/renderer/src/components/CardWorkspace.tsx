import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, Pencil, Play, Plus, Sparkles } from "lucide-react";
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
  conceptID: string;
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

function normalizeChoiceText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

const CARD_CONFLICT_MESSAGE =
  "This topic changed somewhere else. Reload it, then reopen the question and try again; your form is still here.";

function initialForm(topic: KnowledgeTopic, question?: Question, seedSentence?: string): CardForm {
  const correct = question?.choices.find((choice) => choice.isCorrect);
  return {
    sentence: seedSentence ?? (question && correct ? question.prompt.replace("________", correct.text) : question?.prompt ?? ""),
    answer: correct?.text ?? "",
    distractors: question
      ? question.choices.filter((choice) => !choice.isCorrect).map((choice) => ({ id: choice.id, text: choice.text }))
      : [{ id: "choice-distractor-1", text: "" }],
    conceptID: question?.conceptIDs[0] ?? "",
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
  const conceptIDs = form.conceptID === initial.conceptID
    ? question.conceptIDs
    : [
        ...(form.conceptID ? [form.conceptID] : []),
        ...question.conceptIDs.filter((id) => id !== initial.conceptID && id !== form.conceptID)
      ];

  const edit: QuestionEdit = {
    kind: question.kind,
    transferLevel: question.transferLevel,
    prompt: storedPrompt,
    difficulty: question.difficulty,
    conceptIDs,
    gapTags: question.gapTags,
    sourceRefs: question.sourceRefs,
    choices: question.choices.map((choice) => ({
      ...choice,
      text: editedChoiceText.get(choice.id) ?? choice.text
    })),
    explanation: form.explanation.trim()
  };
  const current: QuestionEdit = {
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
  return JSON.stringify(edit) === JSON.stringify(current) ? undefined : edit;
}

export function storedPromptForCard(question: Question | undefined, sentence: string, answer: string): string {
  const prompt = sentence.trim();
  const trimmedAnswer = answer.trim();
  if (question && !question.prompt.includes("________")) return prompt;
  return trimmedAnswer ? prompt.replace(trimmedAnswer, "________") : prompt;
}

export function CardWorkspace({ topic, snapshot, onSnapshot, onReview, onRegisterBeforeLeave, seedSentence, seedToken, onSeedConsumed }: {
  topic: KnowledgeTopic;
  snapshot: AppSnapshot;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onReview: (question: Question) => void;
  onRegisterBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
  seedSentence?: string;
  seedToken?: string;
  onSeedConsumed: () => void;
}) {
  const [editing, setEditing] = useState<Question>();
  const [creating, setCreating] = useState(false);
  const [retiring, setRetiring] = useState<Question>();
  const [createSeed, setCreateSeed] = useState<string>();
  const consumedSeedToken = useRef<string | undefined>(undefined);
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
  return <section className="cards-workspace" aria-labelledby="cards-heading">
    <header className="cards-heading">
      <div><Eyebrow>{active.length} {active.length === 1 ? "question" : "questions"} in this topic</Eyebrow><h2 id="cards-heading">Questions</h2><p>Build a small, reliable question bank from the concepts you want to remember.</p></div>
      <button className="primary" onClick={() => { setCreateSeed(undefined); setEditing(undefined); setCreating(true); }}><Plus /> New question</button>
    </header>
    {active.length ? <div className="cards-list">{active.map((question, index) => <article className="surface authored-card" key={question.id}>
      <div className="authored-card-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
      <div className="authored-card-copy"><Eyebrow>{question.revision > 1 ? `Revision ${question.revision}` : "Question"}</Eyebrow><h3>{question.prompt}</h3><div className="authored-card-concepts">{question.conceptIDs.map((id) => <Tag key={id}>{topic.concepts.find((concept) => concept.id === id)?.title ?? id}</Tag>)}</div></div>
      <div className="card-actions"><button type="button" onClick={() => onReview(question)}><Play /> Review</button><button type="button" onClick={() => { setCreating(false); setEditing(question); }}><Pencil /> Edit</button><button type="button" className="danger-button" onClick={() => setRetiring(question)} aria-label={`Archive ${question.prompt}`} title="Archive question"><Archive /></button></div>
    </article>)}</div> : <div className="surface cards-empty"><Check /><h3>No questions yet</h3><p>Add the first question for this topic. It will enter the normal review queue after you save it.</p><button className="primary" onClick={() => { setCreateSeed(undefined); setCreating(true); }}><Plus /> Create first question</button></div>}
    {retired.length > 0 && <details className="retired-cards"><summary>{retired.length} archived {retired.length === 1 ? "question" : "questions"}</summary><ul>{retired.map((question) => <li key={question.id}>{question.prompt}</li>)}</ul></details>}
    {(creating || editing) && <CardEditor topic={topic} snapshot={snapshot} question={editing} seedSentence={creating ? createSeed : undefined} onSnapshot={onSnapshot} onClose={() => { setCreateSeed(undefined); setCreating(false); setEditing(undefined); }} onReview={onReview} onRegisterBeforeLeave={onRegisterBeforeLeave} />}
    {retiring && <ArchiveCardDialog topic={topic} question={retiring} onSnapshot={onSnapshot} onClose={() => setRetiring(undefined)} />}
  </section>;
}

function CardEditor({ topic, snapshot, question, seedSentence, onSnapshot, onClose, onReview, onRegisterBeforeLeave }: {
  topic: KnowledgeTopic;
  snapshot: AppSnapshot;
  question?: Question;
  seedSentence?: string;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onClose: () => void;
  onReview: (question: Question) => void;
  onRegisterBeforeLeave: (handler: BeforeLeaveGuard | undefined) => void;
}) {
  const [initial] = useState<CardForm>(() => initialForm(topic, question, seedSentence));
  const [form, setForm] = useState<CardForm>(initial);
  const [error, setError] = useState<string>();
  const [distractorError, setDistractorError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [generatingDistractors, setGeneratingDistractors] = useState(false);
  const [generatedDistractors, setGeneratedDistractors] = useState(false);
  const [saved, setSaved] = useState<Question>();
  const pendingStoredPrompt = storedPromptForCard(question, form.sentence, form.answer);
  const pendingExistingEdit = question
    ? buildExistingCardEdit(question, initial, form, pendingStoredPrompt)
    : undefined;
  const dirty = !saved && (question
    ? Boolean(pendingExistingEdit)
    : JSON.stringify(form) !== JSON.stringify(initial));
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
        answer: form.answer.trim(),
        ...(form.conceptID ? { conceptID: form.conceptID } : {})
      });
      const next = fillGeneratedDistractors(form.distractors, generated, form.answer);
      if (next.filter(({ text }) => text.trim()).length === populatedDistractors) {
        setDistractorError("The local model did not return any usable new distractors. Try again or add your own.");
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
      conceptIDs: form.conceptID ? [form.conceptID] : [],
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
      onSnapshot(result.snapshot); setSaved(result.question);
    } catch (cause) { setError(resolveRevisionConflict(cause, CARD_CONFLICT_MESSAGE).message); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={question ? "Edit question" : "Create question"}
      icon={<Pencil />}
      className="card-editor-dialog"
      closeOnBackdrop={false}
      onClose={requestClose}
    >
      {saved ? (
        <div className="card-saved">
          <Check />
          <h3>Question saved</h3>
          <p>{saved.revision > 1 ? `Revision ${saved.revision} will re-enter review as a revised check.` : "It is ready for your next review."}</p>
          <div className="dialog-footer">
            <button type="button" onClick={requestClose}>Done</button>
            <button type="button" className="primary" onClick={() => onReview(saved)}><Play /> Review question</button>
          </div>
        </div>
      ) : (
        <form className="card-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="card-editor-field">
            <span>Sentence containing the answer</span>
            <textarea autoFocus value={form.sentence} onChange={(event) => update("sentence", event.target.value)} placeholder="For example: A bit is a distinguishable physical state." />
          </label>
          <label className="card-editor-field">
            <span>Answer</span>
            <input value={form.answer} onChange={(event) => update("answer", event.target.value)} placeholder="A bit" />
            <small>{question ? "Editing keeps the current answer structure." : sentenceIncludesAnswer ? "The answer appears in the sentence and will be shown as a blank during review." : "Use the exact answer once in the sentence."}</small>
          </label>
          <fieldset className="card-editor-distractors">
            <legend>Distractors</legend>
            {form.distractors.map((item, index) => (
              <label className="card-editor-field" key={item.id}>
                <span>Alternative {index + 1}</span>
                <input value={item.text} onChange={(event) => updateDistractor(item.id, event.target.value)} placeholder="A plausible but incorrect answer" />
              </label>
            ))}
            {!question && form.distractors.length < 3 && <button type="button" className="text-button" onClick={addDistractor}><Plus /> Add distractor</button>}
            {!question && <div className="distractor-assist">
              <div><strong>Need suggestions?</strong><small>Generate up to three plausible wrong answers locally. Your existing options stay untouched.</small></div>
              <button type="button" className="local-assist-button" disabled={generatingDistractors || populatedDistractors >= 3} onClick={() => void generateDistractors()}><Sparkles /> {generatingDistractors ? "Generating…" : "Generate distractors"}</button>
            </div>}
            {generatedDistractors && <p className="distractor-generation-note"><Sparkles /> Generated locally. Review every option before saving.</p>}
            {distractorError && <InlineError message={distractorError} />}
            {question && <small>Choice structure is fixed while editing so existing review evidence remains trustworthy.</small>}
          </fieldset>
          <label className="card-editor-field">
            <span>Linked concept <small>(optional)</small></span>
            <select value={form.conceptID} onChange={(event) => update("conceptID", event.target.value)}>
              <option value="">No linked concept</option>
              {topic.concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.title}</option>)}
            </select>
          </label>
          <label className="card-editor-field">
            <span>Explanation</span>
            <textarea value={form.explanation} onChange={(event) => update("explanation", event.target.value)} placeholder="Why is this answer correct?" />
          </label>
          {error && <InlineError message={error} />}
          <div className="dialog-footer">
            <button type="button" onClick={requestClose}>Cancel</button>
            <button className="primary" disabled={saving || generatingDistractors || Boolean(question && !pendingExistingEdit)} type="submit">{saving ? "Saving…" : "Save question"}</button>
          </div>
        </form>
      )}
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
