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

export interface AppSnapshot {
  topics: KnowledgeTopic[];
  progress: ProgressRecord;
  settings: AppSettings;
  errorMessage?: string;
  platform: NodeJS.Platform;
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

export interface RevemberAPI {
  getSnapshot(): Promise<AppSnapshot>;
  reload(): Promise<AppSnapshot>;
  chooseKnowledgeRoot(): Promise<AppSnapshot>;
  resetKnowledgeRoot(): Promise<AppSnapshot>;
  openKnowledgeRoot(): Promise<void>;
  commitReview(input: CommitReviewInput): Promise<CommitReviewResult>;
  captureCheckpoint(input: CaptureCheckpointInput): Promise<CaptureCheckpointResult>;
  setNotificationsEnabled(enabled: boolean): Promise<AppSnapshot>;
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  onNavigate(callback: (route: string) => void): () => void;
}
