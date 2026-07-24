import { useCallback, useMemo, useState } from "react";
import { Archive, CalendarDays, Check, Pencil, Play, Plus, X } from "lucide-react";
import type { AppSnapshot, StoredExamPlan } from "../../../../shared/types";
import { planExamReviews } from "../../../../shared/planner";
import { Eyebrow, Tag } from "./ui";
import { InlineError } from "./review-ui";
import { useDialogFocus } from "./useDialogFocus";
import { toErrorMessage } from "../utils";

function localTimeZone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }

export function PlannerPage({ snapshot, onSnapshot, onStartSession }: {
  snapshot: AppSnapshot;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onStartSession: (plan: StoredExamPlan) => void;
}) {
  const [editing, setEditing] = useState<StoredExamPlan>();
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<StoredExamPlan>();
  const plans = snapshot.planner.plans.filter((plan) => !plan.archivedAt).sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const archived = snapshot.planner.plans.filter((plan) => plan.archivedAt);
  return <div className="planner-page">
    <header className="planner-heading"><div><Eyebrow>Study windows</Eyebrow><h1>Plan</h1><p>Set the deadline. Revember keeps each card’s own evidence-based due date intact.</p></div>{plans.length > 0 && <button className="primary" onClick={() => { setEditing(undefined); setCreating(true); }}><Plus /> New exam</button>}</header>
    {plans.length ? <div className="plan-list">{plans.map((plan) => <PlanCard key={plan.id} plan={plan} snapshot={snapshot} onEdit={() => { setCreating(false); setEditing(plan); }} onArchive={() => setArchiving(plan)} onStart={() => onStartSession(plan)} />)}</div> : <div className="surface planner-empty"><CalendarDays /><h2>No exam plans yet</h2><p>Add an exam date to create a simple set of study windows across your chosen topics.</p><button className="primary" onClick={() => setCreating(true)}><Plus /> Create exam plan</button></div>}
    {archived.length > 0 && <details className="retired-cards"><summary>{archived.length} archived {archived.length === 1 ? "plan" : "plans"}</summary><ul>{archived.map((plan) => <li key={plan.id}>{plan.examName} · {plan.targetDate}</li>)}</ul></details>}
    {(creating || editing) && <PlanEditor snapshot={snapshot} plan={editing} onSnapshot={onSnapshot} onClose={() => { setCreating(false); setEditing(undefined); }} />}
    {archiving && <ArchivePlanDialog plan={archiving} snapshot={snapshot} onSnapshot={onSnapshot} onClose={() => setArchiving(undefined)} />}
  </div>;
}

function PlanCard({ plan, snapshot, onEdit, onArchive, onStart }: { plan: StoredExamPlan; snapshot: AppSnapshot; onEdit: () => void; onArchive: () => void; onStart: () => void }) {
  const projection = useProjection(plan, snapshot);
  const next = projection?.sessions[0];
  return <article className="surface plan-card"><div className="plan-card-main"><Eyebrow>Exam · {plan.targetDate}</Eyebrow><h2>{plan.examName}</h2><div className="plan-topic-tags">{plan.topicIDs.map((id) => <Tag key={id}>{snapshot.topics.find((topic) => topic.id === id)?.title ?? id}</Tag>)}</div><p>{plan.sessionCount} study {plan.sessionCount === 1 ? "session" : "sessions"} · {plan.timeZone}</p>{projection ? <ol className="session-preview">{projection.sessions.map((session) => <li key={session.date}><span>{session.date}</span><small>{session.items.length ? `${session.items.length} review ${session.items.length === 1 ? "card" : "cards"}` : "Review window"}</small></li>)}</ol> : <InlineError message="This plan needs an upcoming valid date before it can be scheduled." />}</div><div className="plan-actions">{next && <button className="primary" onClick={onStart}><Play /> Start session</button>}<button onClick={onEdit}><Pencil /> Edit</button><button className="danger-button" onClick={onArchive}><Archive /> Archive</button></div></article>;
}

function PlanEditor({ snapshot, plan, onSnapshot, onClose }: { snapshot: AppSnapshot; plan?: StoredExamPlan; onSnapshot: (snapshot: AppSnapshot) => void; onClose: () => void }) {
  const [initial] = useState(() => ({
    examName: plan?.examName ?? "",
    targetDate: plan?.targetDate ?? defaultDate(),
    topicIDs: plan?.topicIDs ?? snapshot.topics.slice(0, 1).map((topic) => topic.id),
    sessionCount: plan?.sessionCount ?? 3,
    timeZone: plan?.timeZone ?? localTimeZone()
  }));
  const [examName, setExamName] = useState(initial.examName);
  const [targetDate, setTargetDate] = useState(initial.targetDate);
  const [topicIDs, setTopicIDs] = useState<string[]>(initial.topicIDs);
  const [sessionCount, setSessionCount] = useState(initial.sessionCount);
  const [error, setError] = useState<string>(); const [saving, setSaving] = useState(false);
  const dirty = examName !== initial.examName || targetDate !== initial.targetDate || sessionCount !== initial.sessionCount || JSON.stringify(topicIDs) !== JSON.stringify(initial.topicIDs);
  const requestClose = useCallback(() => {
    if (!dirty || window.confirm("Discard your unsaved exam-plan changes?")) onClose();
  }, [dirty, onClose]);
  const dialog = useDialogFocus(requestClose);
  const timeZone = initial.timeZone;
  const input = { examName, targetDate, topicIDs, sessionCount, timeZone };
  const preview = useMemo(() => { try { return planExamReviews(input, { topics: snapshot.topics, progress: snapshot.progress }); } catch (cause) { return toErrorMessage(cause); } }, [examName, targetDate, topicIDs, sessionCount, timeZone, snapshot.topics, snapshot.progress]);
  const toggleTopic = (id: string) => setTopicIDs((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const save = async () => {
    if (typeof preview === "string") { setError(preview); return; }
    try { setSaving(true); setError(undefined); const result = await window.revember.upsertExamPlan({ expectedPlannerRevision: snapshot.planner.revision, ...(plan ? { planID: plan.id } : {}), plan: input }); onSnapshot(result.snapshot); onClose(); }
    catch (cause) { setError(friendlyPlanError(cause)); } finally { setSaving(false); }
  };
  return <div className="modal-backdrop" role="presentation"><section ref={dialog.ref} onKeyDown={dialog.onKeyDown} className="settings-dialog plan-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="plan-editor-title"><header><div><CalendarDays /><h2 id="plan-editor-title">{plan ? "Edit exam plan" : "New exam plan"}</h2></div><button className="icon-button" aria-label="Close exam plan editor" onClick={requestClose}><X /></button></header><form className="plan-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <label><span>Exam name</span><input autoFocus value={examName} onChange={(event) => setExamName(event.target.value)} placeholder="BLE exam" /></label>
    <label><span>Exam date</span><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label>
    <fieldset><legend>Topics</legend><div className="topic-checkboxes">{snapshot.topics.map((topic) => <label key={topic.id}><input type="checkbox" checked={topicIDs.includes(topic.id)} onChange={() => toggleTopic(topic.id)} /> <span>{topic.title}</span></label>)}</div></fieldset>
    <label><span>Revision sessions</span><input type="number" min="1" max="365" value={sessionCount} onChange={(event) => setSessionCount(Math.max(1, Number(event.target.value) || 1))} /></label>
    <p className="timezone-note">Dates use your local timezone: <strong>{timeZone}</strong></p>
    <section className="projection-preview"><Eyebrow>Deterministic preview</Eyebrow>{typeof preview === "string" ? <InlineError message={preview} /> : <ol>{preview.sessions.map((session) => <li key={session.date}><span>{session.date}</span><small>{session.items.length ? `${session.items.length} eligible cards` : "Review window"}</small></li>)}</ol>}</section>
    {error && <InlineError message={error} />}<div className="dialog-footer"><button type="button" onClick={requestClose}>Cancel</button><button className="primary" disabled={saving || typeof preview === "string"} type="submit">{saving ? "Saving…" : "Save plan"}</button></div>
  </form></section></div>;
}

function ArchivePlanDialog({ plan, snapshot, onSnapshot, onClose }: { plan: StoredExamPlan; snapshot: AppSnapshot; onSnapshot: (snapshot: AppSnapshot) => void; onClose: () => void }) {
  const [error, setError] = useState<string>(); const [saving, setSaving] = useState(false);
  const dialog = useDialogFocus(onClose);
  const archive = async () => { try { setSaving(true); const result = await window.revember.archiveExamPlan({ expectedPlannerRevision: snapshot.planner.revision, planID: plan.id }); onSnapshot(result.snapshot); onClose(); } catch (cause) { setError(friendlyPlanError(cause)); } finally { setSaving(false); } };
  return <div className="modal-backdrop" role="presentation"><section ref={dialog.ref} onKeyDown={dialog.onKeyDown} className="settings-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-plan-title"><header><div><Archive /><h2 id="archive-plan-title">Archive exam plan</h2></div><button className="icon-button" aria-label="Close archive dialog" onClick={onClose}><X /></button></header><div className="confirm-body"><p>Archive <strong>{plan.examName}</strong>? It will disappear from active planning, but the saved plan remains local.</p>{error && <InlineError message={error} />}<div className="dialog-footer"><button onClick={onClose}>Cancel</button><button className="danger-button" disabled={saving} onClick={() => void archive()}>{saving ? "Archiving…" : "Archive plan"}</button></div></div></section></div>;
}

function useProjection(plan: StoredExamPlan, snapshot: AppSnapshot) { try { return planExamReviews(plan, { topics: snapshot.topics, progress: snapshot.progress }); } catch { return undefined; } }
function defaultDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function friendlyPlanError(cause: unknown): string { const message = toErrorMessage(cause); return /revision conflict|changed while/i.test(message) ? "Your planner changed somewhere else. Reload the app and try again; this form is still open." : message; }
