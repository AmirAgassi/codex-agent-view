import type {
  CodexThread,
  JsonRpcId,
  RpcServerRequest,
  Turn,
} from "../domain/types.js";

export type JsonObject = Record<string, unknown>;

export interface ClientInfo {
  name: string;
  title: string | null;
  version: string;
}

export interface InitializeCapabilities {
  experimentalApi: boolean;
  requestAttestation: boolean;
  mcpServerOpenaiFormElicitation?: boolean;
  optOutNotificationMethods?: string[] | null;
}

export interface InitializeResult {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export interface ThreadListParams {
  cursor?: string | null;
  limit?: number | null;
  sortKey?: "created_at" | "updated_at" | "recency_at" | null;
  sortDirection?: "asc" | "desc" | null;
  modelProviders?: string[] | null;
  sourceKinds?: Array<
    | "cli"
    | "vscode"
    | "exec"
    | "appServer"
    | "subAgent"
    | "subAgentReview"
    | "subAgentCompact"
    | "subAgentThreadSpawn"
    | "subAgentOther"
    | "unknown"
  > | null;
  archived?: boolean | null;
  cwd?: string | string[] | null;
  useStateDbOnly?: boolean;
  searchTerm?: string | null;
}

export interface ThreadListResult {
  data: CodexThread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
}

export interface ThreadReadResult {
  thread: CodexThread;
}

export type ThreadStartParams = JsonObject & {
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  approvalPolicy?: "untrusted" | "on-request" | "never" | JsonObject | null;
  approvalsReviewer?: unknown;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access" | null;
  config?: JsonObject | null;
  serviceName?: string | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: string | null;
  ephemeral?: boolean | null;
  sessionStartSource?: unknown;
  threadSource?: unknown;
};

export type ThreadResumeOptions = JsonObject & {
  model?: string | null;
  modelProvider?: string | null;
  serviceTier?: string | null;
  cwd?: string | null;
  approvalPolicy?: "untrusted" | "on-request" | "never" | JsonObject | null;
  approvalsReviewer?: unknown;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access" | null;
  config?: JsonObject | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: string | null;
};

export interface ThreadSessionResult extends ThreadReadResult {
  model?: string;
  modelProvider?: string;
  serviceTier?: string | null;
  cwd?: string;
  instructionSources?: string[];
  approvalPolicy?: unknown;
  approvalsReviewer?: unknown;
  sandbox?: unknown;
  reasoningEffort?: string | null;
}

export type UserInput =
  | { type: "text"; text: string; text_elements?: unknown[] }
  | { type: "image"; url: string; detail?: "auto" | "low" | "high" | "original" }
  | { type: "localImage"; path: string; detail?: "auto" | "low" | "high" | "original" }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type TurnStartOptions = JsonObject & {
  clientUserMessageId?: string | null;
  cwd?: string | null;
  approvalPolicy?: unknown;
  approvalsReviewer?: unknown;
  sandboxPolicy?: unknown;
  model?: string | null;
  serviceTier?: string | null;
  effort?: string | null;
  summary?: string | null;
  personality?: string | null;
  outputSchema?: unknown;
};

export interface TurnStartParams extends TurnStartOptions {
  threadId: string;
  input: UserInput[];
}

export interface TurnStartResult {
  turn: Turn;
}

export interface TurnSteerResult {
  turnId: string;
}

export type EmptyResult = Record<string, never>;

export interface RpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface ServerRequestReply {
  id: JsonRpcId;
  result?: unknown;
  error?: RpcErrorBody;
}

export type ServerRequestReference = JsonRpcId | RpcServerRequest;
