export interface TopicFileLockOptions {
  timeoutMs?: number;
  staleMs?: number;
  pollMs?: number;
}

export interface TopicMutationOptions {
  knowledgeRoot: string;
  topicPath: string;
  topicID: string;
  expectedRevision?: number;
  transform: (topic: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  validate: (topic: Record<string, unknown>) =>
    | void
    | Record<string, unknown>
    | Promise<void | Record<string, unknown>>;
  lock?: TopicFileLockOptions;
}

export interface TopicMutationResult {
  topic: Record<string, unknown>;
  topicPath: string;
  backupPath: string;
  previousRevision: number;
  revision: number;
}

export class TopicRevisionConflictError extends Error {
  constructor(topicID: string, expectedRevision: number, actualRevision: number);
  readonly code: "REVISION_CONFLICT";
  readonly topicID: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;
}

export function withTopicFileLock<T>(
  knowledgeRoot: string,
  topicID: string,
  operation: () => Promise<T>,
  options?: TopicFileLockOptions
): Promise<T>;

export function mutateTopicJson(options: TopicMutationOptions): Promise<TopicMutationResult>;
