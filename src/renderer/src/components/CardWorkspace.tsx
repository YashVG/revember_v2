import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, Pencil, Play, Plus } from "lucide-react";
import type { AppSnapshot, KnowledgeTopic, Question, QuestionDraft, QuestionEdit } from "../../../../shared/types";
import { activeQuestions } from "../../../../shared/domain";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { Eyebrow, Tag } from "./ui";
import { InlineError } from "./review-ui";
import { Modal } from "./modal";
import { resolveRevisionConflict } from "../utils";

type CardForm = {
  sentence: string;
  answer: string;
  distractors: Array<{ id: string; text: string }>;
  conceptID: string;
  explanation: string;
};

const CARD_CONFLICT_MESSAGE =
  "This topic changed somewhere else. Reload it, then reopen the card and try again; your form is still here.";

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

export function CardWorkspace({ topic, snapshot, onSnapshot, onReview, seedSentence, seedToken, onSeedConsumed }: {
  topic: KnowledgeTopic;
  snapshot: AppSnapshot;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onReview: (question: Question) => void;
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
    if (!seedToken || seedSentence === undefined || consumedSeedToken.current === seedToken) return;
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
      <div><Eyebrow>Topic authoring</Eyebrow><h2 id="cards-heading">Cards</h2><p>Create plain, answerable checks that stay attached to this topic’s concepts.</p></div>
      <button className="primary" onClick={() => { setCreateSeed(undefined); setEditing(undefined); setCreating(true); }}><Plus /> New Card</button>
    </header>
    {active.length ? <div className="cards-list">{active.map((question) => <article className="surface authored-card" key={question.id}>
      <div className="authored-card-copy"><Eyebrow>{question.revision > 1 ? `Revision ${question.revision}` : "New card"}</Eyebrow><h3>{question.prompt}</h3><div>{question.conceptIDs.map((id) => <Tag key={id}>{topic.concepts.find((concept) => concept.id === id)?.title ?? id}</Tag>)}</div></div>
      <div className="card-actions"><button onClick={() => onReview(question)}><Play /> Review this card</button><button onClick={() => { setCreating(false); setEditing(question); }}><Pencil /> Edit</button><button className="danger-button" onClick={() => setRetiring(question)}><Archive /> Archive</button></div>
    </article>)}</div> : <div className="surface cards-empty"><Check /><h3>No cards yet</h3><p>Add the first check for this topic. It will enter the normal review queue after you save it.</p><button className="primary" onClick={() => { setCreateSeed(undefined); setCreating(true); }}><Plus /> Create first card</button></div>}
    {retired.length > 0 && <details className="retired-cards"><summary>{retired.length} archived {retired.length === 1 ? "card" : "cards"}</summary><ul>{retired.map((question) => <li key={question.id}>{question.prompt}</li>)}</ul></details>}
    {(creating || editing) && <CardEditor topic={topic} snapshot={snapshot} question={editing} seedSentence={creating ? createSeed : undefined} onSnapshot={onSnapshot} onClose={() => { setCreateSeed(undefined); setCreating(false); setEditing(undefined); }} onReview={onReview} />}
    {retiring && <ArchiveCardDialog topic={topic} question={retiring} onSnapshot={onSnapshot} onClose={() => setRetiring(undefined)} />}
  </section>;
}

function CardEditor({ topic, snapshot, question, seedSentence, onSnapshot, onClose, onReview }: {
  topic: KnowledgeTopic;
  snapshot: AppSnapshot;
  question?: Question;
  seedSentence?: string;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onClose: () => void;
  onReview: (question: Question) => void;
}) {
  const [initial] = useState<CardForm>(() => initialForm(topic, question, seedSentence));
  const [form, setForm] = useState<CardForm>(initial);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Question>();
  const dirty = !saved && JSON.stringify(form) !== JSON.stringify(initial);
  const requestClose = useCallback(() => {
    if (!dirty || window.confirm("Discard your unsaved card changes?")) onClose();
  }, [dirty, onClose]);
  const sentenceIncludesAnswer = form.answer.trim() && form.sentence.includes(form.answer.trim());
  const cardID = useMemo(() => `card-${crypto.randomUUID()}`, []);
  const correctChoiceID = question?.choices.find((choice) => choice.isCorrect)?.id ?? "choice-correct";
  const update = <K extends keyof CardForm>(key: K, value: CardForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const updateDistractor = (id: string, text: string) => update("distractors", form.distractors.map((item) => item.id === id ? { ...item, text } : item));
  const addDistractor = () => update("distractors", [...form.distractors, { id: `choice-distractor-${form.distractors.length + 1}`, text: "" }]);

  const save = async () => {
    const answer = form.answer.trim();
    const prompt = form.sentence.trim();
    const choices = [{ id: correctChoiceID, text: answer, isCorrect: true }, ...form.distractors.map((item) => ({ id: item.id, text: item.text.trim(), isCorrect: false }))];
    if (!prompt || !answer || !form.explanation.trim() || choices.some((choice) => !choice.text)) {
      setError("Add a sentence, answer, at least one distractor, and an explanation."); return;
    }
    const answerOccurrences = form.sentence.split(answer).length - 1;
    if (!question && answerOccurrences !== 1) { setError("Use the answer exactly once in the sentence. This keeps the blank unambiguous."); return; }
    const storedPrompt = answerOccurrences === 1 ? prompt.replace(answer, "________") : prompt;
    const card = {
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
        ? await window.revember.editCard({ topicID: topic.id, expectedTopicRevision: topic.revision, questionID: question.id, expectedQuestionRevision: question.revision, card: card satisfies QuestionEdit })
        : await window.revember.createCard({ topicID: topic.id, expectedTopicRevision: topic.revision, card: { id: cardID, ...card } satisfies QuestionDraft });
      onSnapshot(result.snapshot); setSaved(result.question);
    } catch (cause) { setError(resolveRevisionConflict(cause, CARD_CONFLICT_MESSAGE).message); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      title={question ? "Edit card" : "Create card"}
      icon={<Pencil />}
      className="card-editor-dialog"
      closeOnBackdrop={false}
      onClose={requestClose}
    >
      {saved ? (
        <div className="card-saved">
          <Check />
          <h3>Card saved</h3>
          <p>{saved.revision > 1 ? `Revision ${saved.revision} will re-enter review as a revised check.` : "It is ready for your next review."}</p>
          <div className="dialog-footer">
            <button type="button" onClick={requestClose}>Done</button>
            <button type="button" className="primary" onClick={() => onReview(saved)}><Play /> Review this card</button>
          </div>
        </div>
      ) : (
        <form className="card-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label>
            <span>Sentence containing the answer</span>
            <textarea autoFocus value={form.sentence} onChange={(event) => update("sentence", event.target.value)} placeholder="For example: A bit is a distinguishable physical state." />
          </label>
          <label>
            <span>Answer</span>
            <input value={form.answer} onChange={(event) => update("answer", event.target.value)} placeholder="A bit" />
            <small>{question ? "Editing keeps the current answer structure." : sentenceIncludesAnswer ? "The answer appears in the sentence and will be shown as a blank during review." : "Use the exact answer once in the sentence."}</small>
          </label>
          <fieldset>
            <legend>Distractors</legend>
            {form.distractors.map((item, index) => (
              <label key={item.id}>
                <span>Alternative {index + 1}</span>
                <input value={item.text} onChange={(event) => updateDistractor(item.id, event.target.value)} placeholder="A plausible but incorrect answer" />
              </label>
            ))}
            {!question && form.distractors.length < 3 && <button type="button" className="text-button" onClick={addDistractor}><Plus /> Add distractor</button>}
            {question && <small>Choice structure is fixed while editing so existing review evidence remains trustworthy.</small>}
          </fieldset>
          <label>
            <span>Linked concept <small>(optional)</small></span>
            <select value={form.conceptID} onChange={(event) => update("conceptID", event.target.value)}>
              <option value="">No linked concept</option>
              {topic.concepts.map((concept) => <option key={concept.id} value={concept.id}>{concept.title}</option>)}
            </select>
          </label>
          <label>
            <span>Explanation</span>
            <textarea value={form.explanation} onChange={(event) => update("explanation", event.target.value)} placeholder="Why is this answer correct?" />
          </label>
          {error && <InlineError message={error} />}
          <div className="dialog-footer">
            <button type="button" onClick={requestClose}>Cancel</button>
            <button className="primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save card"}</button>
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
      title="Archive card"
      icon={<Archive />}
      confirmLabel="Archive card"
      pendingLabel="Archiving…"
      isConfirming={saving}
      error={error}
      onConfirm={() => void archive()}
      onClose={onClose}
    >
      <p>Archive this card? It will no longer appear in active review, while its past evidence stays readable.</p>
      <strong>{question.prompt}</strong>
    </ConfirmationDialog>
  );
}
