import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels } from "../shared/ipc";
import type {
  AppSnapshot,
  AuthActionResult,
  AuthState,
  ArchiveExamPlanInput,
  CardMutationResult,
  CaptureCheckpointInput,
  CaptureCheckpointResult,
  CaptureSegmentation,
  CaptureSummary,
  CommitReviewInput,
  CommitReviewResult,
  CreateCardInput,
  CreateTopicInput,
  CreateTopicResult,
  EditCardInput,
  GenerateDistractorsInput,
  LearnerCapture,
  McpClient,
  McpConnectionResult,
  PlannerMutationResult,
  RetireCardInput,
  RevemberAPI,
  SaveCaptureInput,
  UpsertExamPlanInput
} from "../shared/types";

const api: RevemberAPI = {
  getAuthState: () => invoke<AuthState>(ipcChannels.getAuthState),
  signUp: (email: string, password: string) => invoke<AuthActionResult>(ipcChannels.signUp, email, password),
  signIn: (email: string, password: string) => invoke<AuthActionResult>(ipcChannels.signIn, email, password),
  signOut: () => invoke<AuthState>(ipcChannels.signOut),
  getSnapshot: () => invoke<AppSnapshot>(ipcChannels.getSnapshot),
  reload: () => invoke<AppSnapshot>(ipcChannels.reload),
  createTopic: (input: CreateTopicInput) => invoke<CreateTopicResult>(ipcChannels.createTopic, input),
  chooseKnowledgeRoot: () => invoke<AppSnapshot>(ipcChannels.chooseKnowledgeRoot),
  resetKnowledgeRoot: () => invoke<AppSnapshot>(ipcChannels.resetKnowledgeRoot),
  openKnowledgeRoot: () => invoke<void>(ipcChannels.openKnowledgeRoot),
  configureMcpClient: (client: McpClient, action: "connect" | "disconnect") => invoke<McpConnectionResult>(ipcChannels.configureMcpClient, client, action),
  commitReview: (input: CommitReviewInput) => invoke<CommitReviewResult>(ipcChannels.commitReview, input),
  captureCheckpoint: (input: CaptureCheckpointInput) => invoke<CaptureCheckpointResult>(ipcChannels.captureCheckpoint, input),
  createCard: (input: CreateCardInput) => invoke<CardMutationResult>(ipcChannels.createCard, input),
  editCard: (input: EditCardInput) => invoke<CardMutationResult>(ipcChannels.editCard, input),
  retireCard: (input: RetireCardInput) => invoke<CardMutationResult>(ipcChannels.retireCard, input),
  generateDistractors: (input: GenerateDistractorsInput) => invoke<string[]>(ipcChannels.generateDistractors, input),
  upsertExamPlan: (input: UpsertExamPlanInput) => invoke<PlannerMutationResult>(ipcChannels.upsertExamPlan, input),
  archiveExamPlan: (input: ArchiveExamPlanInput) => invoke<PlannerMutationResult>(ipcChannels.archiveExamPlan, input),
  listCaptureSummaries: () => invoke<CaptureSummary[]>(ipcChannels.listCaptureSummaries),
  getCapture: (id: string) => invoke<LearnerCapture>(ipcChannels.getCapture, id),
  saveCapture: (input: SaveCaptureInput) => invoke<LearnerCapture>(ipcChannels.saveCapture, input),
  finishCapture: (id: string, expectedRevision: number) => invoke<LearnerCapture>(ipcChannels.finishCapture, id, expectedRevision),
  archiveCapture: (id: string, expectedRevision: number) => invoke<LearnerCapture>(ipcChannels.archiveCapture, id, expectedRevision),
  getCaptureSegmentation: (captureID: string, captureRevision: number) => invoke<CaptureSegmentation | undefined>(ipcChannels.getCaptureSegmentation, captureID, captureRevision),
  retryCaptureSegmentation: (captureID: string, captureRevision: number) => invoke<CaptureSegmentation>(ipcChannels.retryCaptureSegmentation, captureID, captureRevision),
  setNotificationsEnabled: (enabled: boolean) => invoke<AppSnapshot>(ipcChannels.setNotifications, enabled),
  onAuthState: (callback) => subscribe(ipcChannels.authState, callback),
  onSnapshot: (callback) => subscribe(ipcChannels.snapshot, callback),
  onNavigate: (callback) => subscribe(ipcChannels.navigate, callback)
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
