export type ReviewRating = "missed" | "hard" | "good" | "easy";
export type QuestionKind =
  | "multipleChoice"
  | "freeRecall"
  | "explain"
  | "predict"
  | "compare"
  | "trace"
  | "debug";
export type TransferLevel = "recall" | "application" | "transfer";
export type QuestionDifficulty = "intro" | "medium" | "hard";
export type RelationshipKind = "prerequisite" | "partOf" | "contrastsWith" | "enables";

export interface KnowledgeSource {
  id: string;
  kind: string;
  title: string;
  locator?: string;
  fingerprint?: string;
  capturedAt?: string;
}

export interface KnowledgeRelationship {
  id: string;
  sourceConceptID: string;
  targetConceptID: string;
  kind: RelationshipKind;
  rationale: string;
  sourceRefs: string[];
}

export interface Concept {
  id: string;
  title: string;
  firstPrinciples: string;
  explanation: string;
  relatedTerms: string[];
  confusableTerms: string[];
  gapTags: string[];
  sourceRefs: string[];
}

export interface Gap {
  id: string;
  title: string;
  tag: string;
  description: string;
  conceptIDs: string[];
  misconceptionIDs: string[];
  sourceRefs: string[];
}

export interface AnswerChoice {
  id: string;
  text: string;
  isCorrect: boolean;
  rationale?: string;
  misconceptionID?: string;
}

export interface Question {
  id: string;
  revision: number;
  kind: QuestionKind;
  transferLevel: TransferLevel;
  prompt: string;
  difficulty: QuestionDifficulty;
  conceptIDs: string[];
  gapTags: string[];
  sourceRefs: string[];
  choices: AnswerChoice[];
  explanation: string;
  retiredAt?: string;
}

export interface KnowledgeTopic {
  schemaVersion: number;
  revision: number;
  id: string;
  title: string;
  summary: string;
  sources: KnowledgeSource[];
  relationships: KnowledgeRelationship[];
  concepts: Concept[];
  gaps: Gap[];
  questions: Question[];
}

export interface ReviewEvent {
  id: string;
  topicID: string;
  questionID: string;
  questionRevision: number;
  questionKind?: QuestionKind;
  transferLevel?: TransferLevel;
  questionPrompt?: string;
  choiceID: string;
  selectedChoiceText?: string;
  correctChoiceID?: string;
  correctChoiceText?: string;
  isCorrect: boolean;
  rating: ReviewRating;
  conceptIDs: string[];
  gapTags: string[];
  misconceptionIDs: string[];
  sourceRefs: string[];
  reviewedAt: string;
}

export interface ReviewCardState {
  schedulerVersion: string;
  questionRevision: number;
  dueAt: string;
  intervalDays: number;
  stability: number;
  difficulty: number;
  lastRating?: ReviewRating;
  lapses: number;
  reviews: number;
  lastReviewedAt?: string;
}

export interface QuestionProgress {
  attempts: number;
  correctAttempts: number;
  lastAnsweredAt?: string;
}

export interface TopicProgress {
  attemptsByQuestionID: Record<string, QuestionProgress>;
  weakConceptIDs: Record<string, number>;
  lastReviewedAt?: string;
  reviewCardsByQuestionID: Record<string, ReviewCardState>;
}

export interface ProgressRecord {
  schemaVersion: number;
  topics: Record<string, TopicProgress>;
  reviewEvents: ReviewEvent[];
}

export interface DueReviewItem {
  id: string;
  topicID: string;
  questionID: string;
  topic: KnowledgeTopic;
  question: Question;
  dueAt?: string;
  isNew: boolean;
  isRevised: boolean;
}

export interface AppSettings {
  knowledgeRootPath: string;
  progressPath: string;
  notificationsEnabled: boolean;
}

export interface StoredExamPlan {
  id: string;
  examName: string;
  targetDate: string;
  topicIDs: string[];
  sessionCount: number;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface PlannerRecord {
  schemaVersion: 1;
  revision: number;
  plans: StoredExamPlan[];
}

export interface AppSnapshot {
  topics: KnowledgeTopic[];
  progress: ProgressRecord;
  planner: PlannerRecord;
  settings: AppSettings;
  errorMessage?: string;
  platform: NodeJS.Platform;
}

export type QuestionDraft = Omit<Question, "revision" | "retiredAt">;
export type QuestionEdit = Omit<QuestionDraft, "id">;

export interface CreateCardInput {
  topicID: string;
  expectedTopicRevision: number;
  card: QuestionDraft;
}

export interface EditCardInput {
  topicID: string;
  expectedTopicRevision: number;
  questionID: string;
  expectedQuestionRevision: number;
  card: QuestionEdit;
}

export interface RetireCardInput {
  topicID: string;
  expectedTopicRevision: number;
  questionID: string;
  expectedQuestionRevision: number;
}

export interface CardMutationResult {
  snapshot: AppSnapshot;
  topic: KnowledgeTopic;
  question: Question;
}

export interface UpsertExamPlanInput {
  expectedPlannerRevision: number;
  planID?: string;
  plan: Omit<StoredExamPlan, "id" | "createdAt" | "updatedAt" | "archivedAt">;
}

export interface ArchiveExamPlanInput {
  expectedPlannerRevision: number;
  planID: string;
}

export interface PlannerMutationResult {
  snapshot: AppSnapshot;
  plan: StoredExamPlan;
}

export interface CommitReviewInput {
  topicID: string;
  questionID: string;
  questionRevision: number;
  choiceID: string;
  rating: ReviewRating;
  eventID: string;
  reviewedAt?: string;
}

export interface CommitReviewResult {
  snapshot: AppSnapshot;
  event: ReviewEvent;
  cardState: ReviewCardState;
  wasInserted: boolean;
}

export interface CaptureCheckpointInput {
  summary: string;
  topicID?: string;
  openQuestion?: string;
}

export interface CaptureCheckpointResult {
  snapshot: AppSnapshot;
  filePath: string;
}

export type CaptureStatus = "draft" | "ready" | "archived";

export interface CaptureConcisePoint {
  id: string;
  text: string;
}

export interface LearnerCapture {
  schemaVersion: 1;
  id: string;
  revision: number;
  topicID: string;
  title: string;
  rawText: string;
  concisePoints: CaptureConcisePoint[];
  status: CaptureStatus;
  createdAt: string;
  updatedAt: string;
}

/** Metadata returned while browsing captures. Raw learner text stays on disk. */
export interface CaptureSummary {
  id: string;
  revision: number;
  topicID: string;
  title: string;
  status: CaptureStatus;
  concisePointCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CaptureConcisePointInput {
  /** Existing point ID on edit. Omit for a new server-assigned point ID. */
  id?: string;
  text: string;
}

export interface SaveCaptureInput {
  /** Omit on create. The main process assigns capture IDs. */
  id?: string;
  /** Use zero on create, or the currently loaded revision on edit. */
  expectedRevision: number;
  topicID: string;
  title: string;
  rawText: string;
  concisePoints: CaptureConcisePointInput[];
  status: Exclude<CaptureStatus, "archived">;
}

export type CaptureEnrichmentStatus = "queued" | "running" | "ready" | "failed" | "unavailable";

export interface CaptureEnrichmentTakeaway {
  text: string;
  evidence: string;
}

export interface CaptureEnrichmentResult {
  summary: string;
  takeaways: CaptureEnrichmentTakeaway[];
  openQuestions: string[];
}

/** A model response stored separately from the user-authored capture. */
export interface CaptureEnrichment {
  schemaVersion: 1;
  captureID: string;
  captureRevision: number;
  status: CaptureEnrichmentStatus;
  result?: CaptureEnrichmentResult;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevemberAPI {
  getSnapshot(): Promise<AppSnapshot>;
  reload(): Promise<AppSnapshot>;
  chooseKnowledgeRoot(): Promise<AppSnapshot>;
  resetKnowledgeRoot(): Promise<AppSnapshot>;
  openKnowledgeRoot(): Promise<void>;
  commitReview(input: CommitReviewInput): Promise<CommitReviewResult>;
  captureCheckpoint(input: CaptureCheckpointInput): Promise<CaptureCheckpointResult>;
  createCard(input: CreateCardInput): Promise<CardMutationResult>;
  editCard(input: EditCardInput): Promise<CardMutationResult>;
  retireCard(input: RetireCardInput): Promise<CardMutationResult>;
  upsertExamPlan(input: UpsertExamPlanInput): Promise<PlannerMutationResult>;
  archiveExamPlan(input: ArchiveExamPlanInput): Promise<PlannerMutationResult>;
  listCaptureSummaries(): Promise<CaptureSummary[]>;
  getCapture(id: string): Promise<LearnerCapture>;
  saveCapture(input: SaveCaptureInput): Promise<LearnerCapture>;
  finishCapture(id: string, expectedRevision: number): Promise<LearnerCapture>;
  archiveCapture(id: string, expectedRevision: number): Promise<LearnerCapture>;
  getCaptureEnrichment(captureID: string, captureRevision: number): Promise<CaptureEnrichment | undefined>;
  retryCaptureEnrichment(captureID: string, captureRevision: number): Promise<CaptureEnrichment>;
  setNotificationsEnabled(enabled: boolean): Promise<AppSnapshot>;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  onNavigate(callback: (route: string) => void): () => void;
}
