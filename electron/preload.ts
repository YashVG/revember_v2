import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSnapshot,
  ArchiveExamPlanInput,
  CardMutationResult,
  CaptureCheckpointInput,
  CaptureCheckpointResult,
  CaptureSummary,
  CommitReviewInput,
  CommitReviewResult,
  CreateCardInput,
  EditCardInput,
  LearnerCapture,
  PlannerMutationResult,
  RetireCardInput,
  RevemberAPI,
  SaveCaptureInput,
  UpsertExamPlanInput
} from "../shared/types";

const api: RevemberAPI = {
  getSnapshot: () => invoke<AppSnapshot>("revember:get-snapshot"),
  reload: () => invoke<AppSnapshot>("revember:reload"),
  chooseKnowledgeRoot: () => invoke<AppSnapshot>("revember:choose-knowledge-root"),
  resetKnowledgeRoot: () => invoke<AppSnapshot>("revember:reset-knowledge-root"),
  openKnowledgeRoot: () => invoke<void>("revember:open-knowledge-root"),
  commitReview: (input: CommitReviewInput) => invoke<CommitReviewResult>("revember:commit-review", input),
  captureCheckpoint: (input: CaptureCheckpointInput) => invoke<CaptureCheckpointResult>("revember:capture-checkpoint", input),
  createCard: (input: CreateCardInput) => invoke<CardMutationResult>("revember:create-card", input),
  editCard: (input: EditCardInput) => invoke<CardMutationResult>("revember:edit-card", input),
  retireCard: (input: RetireCardInput) => invoke<CardMutationResult>("revember:retire-card", input),
  upsertExamPlan: (input: UpsertExamPlanInput) => invoke<PlannerMutationResult>("revember:upsert-exam-plan", input),
  archiveExamPlan: (input: ArchiveExamPlanInput) => invoke<PlannerMutationResult>("revember:archive-exam-plan", input),
  listCaptureSummaries: () => invoke<CaptureSummary[]>("revember:list-capture-summaries"),
  getCapture: (id: string) => invoke<LearnerCapture>("revember:get-capture", id),
  saveCapture: (input: SaveCaptureInput) => invoke<LearnerCapture>("revember:save-capture", input),
  archiveCapture: (id: string, expectedRevision: number) => invoke<LearnerCapture>("revember:archive-capture", id, expectedRevision),
  setNotificationsEnabled: (enabled: boolean) => invoke<AppSnapshot>("revember:set-notifications", enabled),
  onSnapshot: (callback) => subscribe("revember:snapshot", callback),
  onNavigate: (callback) => subscribe("revember:navigate", callback)
};

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("revember", api);
