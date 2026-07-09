import type {
  CodexThread,
  DashboardState,
  JsonRpcId,
  PendingRequest,
  RpcInboundMessage,
  SessionRecord,
  ThreadItem,
  ThreadStatus,
  Turn,
} from "./types.js";

type TimestampedAction = { at?: number };

export type DashboardAction =
  | ({
      type: "connection/changed";
      connection: DashboardState["connection"];
      error?: string;
    } & TimestampedAction)
  | ({ type: "thread/list"; threads: CodexThread[]; replace?: boolean } & TimestampedAction)
  | ({ type: "thread/upsert"; thread: CodexThread } & TimestampedAction)
  | ({ type: "thread/status"; threadId: string; status: ThreadStatus } & TimestampedAction)
  | ({ type: "thread/name"; threadId: string; name: string | null } & TimestampedAction)
  | ({ type: "thread/archive" | "thread/delete"; threadId: string } & TimestampedAction)
  | ({ type: "turn/started"; threadId: string; turn: Turn } & TimestampedAction)
  | ({ type: "turn/completed"; threadId: string; turn: Turn } & TimestampedAction)
  | ({
      type: "turn/plan";
      threadId: string;
      turnId: string;
      plan: Array<{ step: string; status: string }>;
    } & TimestampedAction)
  | ({ type: "turn/diff"; threadId: string; turnId: string; diff: string } & TimestampedAction)
  | ({
      type: "item/started" | "item/updated" | "item/completed";
      threadId: string;
      turnId: string;
      item: ThreadItem;
    } & TimestampedAction)
  | ({
      type: "item/delta";
      threadId: string;
      turnId: string;
      itemId: string;
      delta: string;
      field?: "text" | "aggregatedOutput";
      itemType?: "agentMessage" | "plan" | "commandExecution";
    } & TimestampedAction)
  | ({
      type: "item/reasoningSummaryDelta";
      threadId: string;
      turnId: string;
      itemId: string;
      summaryIndex: number;
      delta?: string;
    } & TimestampedAction)
  | ({
      type: "item/filePatch";
      threadId: string;
      turnId: string;
      itemId: string;
      changes: unknown[];
    } & TimestampedAction)
  | ({
      type: "item/mcpProgress";
      threadId: string;
      turnId: string;
      itemId: string;
      message: string;
    } & TimestampedAction)
  | ({
      type: "turn/error";
      threadId: string;
      turnId: string;
      message: string;
      willRetry: boolean;
    } & TimestampedAction)
  | ({ type: "serverRequest/received"; request: PendingRequest } & TimestampedAction)
  | ({ type: "serverRequest/resolved"; requestId: JsonRpcId; threadId?: string } & TimestampedAction)
  | ({ type: "rpc/message"; message: RpcInboundMessage } & TimestampedAction);

export const INITIAL_DASHBOARD_STATE: DashboardState = Object.freeze({
  sessions: {},
  connection: "connecting",
});

export function createInitialDashboardState(
  connection: DashboardState["connection"] = "connecting",
): DashboardState {
  return { sessions: {}, connection };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function epochMilliseconds(value: number): number {
  return Math.abs(value) < 100_000_000_000 ? value * 1_000 : value;
}

function actionTime(at: number | undefined): number {
  return at === undefined ? Date.now() : epochMilliseconds(at);
}

function threadTime(thread: CodexThread): number {
  const timestamp = thread.recencyAt ?? thread.updatedAt ?? thread.createdAt;
  return epochMilliseconds(timestamp);
}

function placeholderThread(threadId: string, at: number): CodexThread {
  const seconds = Math.floor(at / 1_000);
  return {
    id: threadId,
    preview: "",
    createdAt: seconds,
    updatedAt: seconds,
    status: { type: "notLoaded" },
    cwd: "",
    turns: [],
  };
}

function mergeItems(previous: ThreadItem[], incoming: ThreadItem[]): ThreadItem[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const merged = incoming.map((item) => ({
    ...previousById.get(item.id),
    ...item,
  } as ThreadItem));
  const incomingIds = new Set(incoming.map((item) => item.id));
  for (const item of previous) {
    if (!incomingIds.has(item.id)) merged.push(item);
  }
  return merged;
}

function mergeTurn(previous: Turn | undefined, incoming: Turn): Turn {
  if (previous === undefined) {
    return { ...incoming, items: [...incoming.items] };
  }
  const previousView = (previous as Turn & { itemsView?: string }).itemsView;
  const incomingView = (incoming as Turn & { itemsView?: string }).itemsView;
  return {
    ...previous,
    ...incoming,
    items: mergeItems(previous.items, incoming.items),
    ...(
      previousView === "full" && incomingView === "notLoaded"
        ? { itemsView: previousView }
        : {}
    ),
  };
}

function mergeTurns(previous: Turn[], incoming: Turn[]): Turn[] {
  const previousById = new Map(previous.map((turn) => [turn.id, turn]));
  const merged = incoming.map((turn) => mergeTurn(previousById.get(turn.id), turn));
  const incomingIds = new Set(incoming.map((turn) => turn.id));
  for (const turn of previous) {
    if (!incomingIds.has(turn.id)) merged.push(turn);
  }
  return merged;
}

function replaceTurn(turns: Turn[], nextTurn: Turn): Turn[] {
  const index = turns.findIndex((turn) => turn.id === nextTurn.id);
  if (index === -1) return [...turns, nextTurn];
  const result = [...turns];
  result[index] = nextTurn;
  return result;
}

function compactText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function userMessageText(item: ThreadItem): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .map((part) => {
      const record = asRecord(part);
      return record?.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join(" ");
}

export function itemActivity(item: ThreadItem): string {
  switch (item.type) {
    case "agentMessage":
    case "plan":
      return compactText(item.text ?? "");
    case "userMessage":
      return compactText(userMessageText(item));
    case "reasoning": {
      const summary = Array.isArray(item.summary)
        ? item.summary.filter((part): part is string => typeof part === "string").at(-1)
        : undefined;
      return compactText(summary ?? "Reasoning…");
    }
    case "commandExecution": {
      const command = Array.isArray(item.command) ? item.command.join(" ") : item.command;
      const label = typeof command === "string" ? compactText(command) : "command";
      return item.status === "completed" ? `Ran: ${label}` : `Running: ${label}`;
    }
    case "fileChange":
      return item.status === "completed" ? "Applied file changes" : "Applying file changes…";
    case "mcpToolCall":
    case "dynamicToolCall": {
      const tool = typeof item.tool === "string" ? item.tool : "tool";
      return item.status === "completed" ? `Used ${tool}` : `Using ${tool}…`;
    }
    case "collabAgentToolCall":
      return "Coordinating agents…";
    case "webSearch":
      return "Searching the web…";
    case "imageView":
      return "Viewing an image…";
    case "imageGeneration":
      return "Generating an image…";
    default:
      return "Working…";
  }
}

function latestAgentText(turns: Turn[]): string {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (turn === undefined) continue;
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (item?.type === "agentMessage" && item.text !== undefined) {
        const text = compactText(item.text);
        if (text !== "") return text;
      }
    }
  }
  return "";
}

function latestActivity(turns: Turn[]): string {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (turn === undefined) continue;
    const item = turn.items.at(-1);
    if (item !== undefined) return itemActivity(item);
    if (turn.status === "failed") return compactText(turn.error?.message ?? "Turn failed");
  }
  return "";
}

function extractPlan(turns: Turn[]): SessionRecord["plan"] {
  const planItem = turns
    .flatMap((turn) => turn.items)
    .findLast((item) => item.type === "plan" && Array.isArray(item.plan));
  if (planItem === undefined || !Array.isArray(planItem.plan)) return [];
  return planItem.plan.flatMap((entry) => {
    const record = asRecord(entry);
    return typeof record?.step === "string" && typeof record.status === "string"
      ? [{ step: record.step, status: record.status }]
      : [];
  });
}

export function createSessionRecord(thread: CodexThread): SessionRecord {
  const turns = mergeTurns([], thread.turns ?? []);
  const activeTurn = turns.findLast((turn) => turn.status === "inProgress");
  return {
    thread: { ...thread, turns },
    turns,
    activeTurnId: activeTurn?.id,
    latestText: latestAgentText(turns),
    activity: latestActivity(turns),
    plan: extractPlan(turns),
    diff: "",
    pendingRequests: [],
    lastChangedAt: threadTime(thread),
  };
}

function ensureSession(state: DashboardState, threadId: string, at: number): SessionRecord {
  return state.sessions[threadId] ?? createSessionRecord(placeholderThread(threadId, at));
}

function withSession(
  state: DashboardState,
  threadId: string,
  session: SessionRecord,
): DashboardState {
  return { ...state, sessions: { ...state.sessions, [threadId]: session } };
}

function withTurns(session: SessionRecord, turns: Turn[]): SessionRecord {
  return {
    ...session,
    thread: { ...session.thread, turns },
    turns,
  };
}

function touchThread(thread: CodexThread, at: number): CodexThread {
  return { ...thread, updatedAt: Math.floor(at / 1_000) };
}

function applyThreadUpsert(
  state: DashboardState,
  thread: CodexThread,
  at: number | undefined,
): DashboardState {
  const previous = state.sessions[thread.id];
  if (previous === undefined) {
    const created = createSessionRecord(thread);
    return withSession(
      state,
      thread.id,
      at === undefined ? created : { ...created, lastChangedAt: actionTime(at) },
    );
  }

  // Most live thread payloads deliberately contain an empty turns array. Do not
  // let one of those erase history already obtained through thread/read.
  const incomingTurns = thread.turns ?? [];
  const turns = incomingTurns.length === 0 ? previous.turns : mergeTurns(previous.turns, incomingTurns);
  const incomingTime = threadTime(thread);
  const incomingIsOlder = at === undefined && incomingTime < previous.lastChangedAt;
  const mergedThread: CodexThread = {
    ...previous.thread,
    ...thread,
    status: incomingIsOlder ? previous.thread.status : thread.status,
    turns,
  };
  const activeTurn = turns.findLast((turn) => turn.status === "inProgress");
  const statusIsActive = mergedThread.status.type === "active";
  const pendingRequests = statusIsActive ? previous.pendingRequests : [];
  return withSession(state, thread.id, {
    ...previous,
    thread: mergedThread,
    turns,
    activeTurnId: activeTurn?.id,
    latestText: latestAgentText(turns) || previous.latestText,
    activity: latestActivity(turns) || previous.activity,
    pendingRequests,
    lastChangedAt: at === undefined
      ? Math.max(previous.lastChangedAt, incomingTime)
      : actionTime(at),
  });
}

function requestActivity(request: PendingRequest): string {
  const params = request.params;
  if (request.method === "item/tool/requestUserInput") {
    const questions = Array.isArray(params.questions) ? params.questions : [];
    const first = asRecord(questions[0]);
    if (typeof first?.question === "string") return compactText(first.question);
    return "Waiting for your input";
  }
  if (typeof params.reason === "string" && compactText(params.reason) !== "") {
    return compactText(params.reason);
  }
  if (typeof params.command === "string" && compactText(params.command) !== "") {
    return `Approve: ${compactText(params.command)}`;
  }
  return "Waiting for approval";
}

function inboundMessageAction(message: RpcInboundMessage, at?: number): DashboardAction | undefined {
  if (!("method" in message)) return undefined;
  const params = asRecord(message.params) ?? {};
  const threadId = typeof params.threadId === "string" ? params.threadId : undefined;

  switch (message.method) {
    case "thread/started":
      return asRecord(params.thread) === undefined
        ? undefined
        : { type: "thread/upsert", thread: params.thread as unknown as CodexThread, at };
    case "thread/status/changed":
      return threadId === undefined || asRecord(params.status) === undefined
        ? undefined
        : { type: "thread/status", threadId, status: params.status as ThreadStatus, at };
    case "thread/name/updated":
      return threadId === undefined
        ? undefined
        : {
            type: "thread/name",
            threadId,
            name: typeof params.threadName === "string" ? params.threadName : null,
            at,
          };
    case "thread/archived":
      return threadId === undefined ? undefined : { type: "thread/archive", threadId, at };
    case "thread/closed":
      return threadId === undefined
        ? undefined
        : { type: "thread/status", threadId, status: { type: "notLoaded" }, at };
    case "thread/deleted":
      return threadId === undefined ? undefined : { type: "thread/delete", threadId, at };
    case "turn/started":
      return threadId === undefined || asRecord(params.turn) === undefined
        ? undefined
        : { type: "turn/started", threadId, turn: params.turn as unknown as Turn, at };
    case "turn/completed":
      return threadId === undefined || asRecord(params.turn) === undefined
        ? undefined
        : { type: "turn/completed", threadId, turn: params.turn as unknown as Turn, at };
    case "turn/plan/updated":
      return threadId === undefined || typeof params.turnId !== "string" || !Array.isArray(params.plan)
        ? undefined
        : {
            type: "turn/plan",
            threadId,
            turnId: params.turnId,
            plan: params.plan as Array<{ step: string; status: string }>,
            at,
          };
    case "turn/diff/updated":
      return threadId === undefined || typeof params.turnId !== "string" || typeof params.diff !== "string"
        ? undefined
        : { type: "turn/diff", threadId, turnId: params.turnId, diff: params.diff, at };
    case "item/started":
    case "item/completed":
      return threadId === undefined || typeof params.turnId !== "string" || asRecord(params.item) === undefined
        ? undefined
        : {
            type: message.method,
            threadId,
            turnId: params.turnId,
            item: params.item as unknown as ThreadItem,
            at,
          };
    case "item/agentMessage/delta":
    case "item/plan/delta":
      return threadId === undefined ||
        typeof params.turnId !== "string" ||
        typeof params.itemId !== "string" ||
        typeof params.delta !== "string"
        ? undefined
        : {
            type: "item/delta",
            threadId,
            turnId: params.turnId,
            itemId: params.itemId,
            delta: params.delta,
            field: "text",
            itemType: message.method === "item/plan/delta" ? "plan" : "agentMessage",
            at,
          };
    case "item/commandExecution/outputDelta":
      return threadId === undefined ||
        typeof params.turnId !== "string" ||
        typeof params.itemId !== "string" ||
        typeof params.delta !== "string"
        ? undefined
        : {
            type: "item/delta",
            threadId,
            turnId: params.turnId,
            itemId: params.itemId,
            delta: params.delta,
            field: "aggregatedOutput",
            itemType: "commandExecution",
            at,
          };
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
      return threadId === undefined ||
        typeof params.turnId !== "string" ||
        typeof params.itemId !== "string" ||
        typeof params.summaryIndex !== "number" ||
        (message.method === "item/reasoning/summaryTextDelta" && typeof params.delta !== "string")
        ? undefined
        : {
            type: "item/reasoningSummaryDelta",
            threadId,
            turnId: params.turnId,
            itemId: params.itemId,
            summaryIndex: params.summaryIndex,
            ...(typeof params.delta === "string" ? { delta: params.delta } : {}),
            at,
          };
    case "item/fileChange/patchUpdated":
      return threadId === undefined ||
        typeof params.turnId !== "string" ||
        typeof params.itemId !== "string" ||
        !Array.isArray(params.changes)
        ? undefined
        : {
            type: "item/filePatch",
            threadId,
            turnId: params.turnId,
            itemId: params.itemId,
            changes: params.changes,
            at,
          };
    case "item/mcpToolCall/progress":
      return threadId === undefined ||
        typeof params.turnId !== "string" ||
        typeof params.itemId !== "string" ||
        typeof params.message !== "string"
        ? undefined
        : {
            type: "item/mcpProgress",
            threadId,
            turnId: params.turnId,
            itemId: params.itemId,
            message: params.message,
            at,
          };
    case "error": {
      const error = asRecord(params.error);
      return threadId === undefined ||
        typeof params.turnId !== "string" ||
        typeof error?.message !== "string"
        ? undefined
        : {
            type: "turn/error",
            threadId,
            turnId: params.turnId,
            message: error.message,
            willRetry: params.willRetry === true,
            at,
          };
    }
    case "serverRequest/resolved": {
      const requestId = params.requestId;
      return (typeof requestId !== "string" && typeof requestId !== "number")
        ? undefined
        : { type: "serverRequest/resolved", requestId, threadId, at };
    }
    default:
      if (!("id" in message) || threadId === undefined) return undefined;
      return {
        type: "serverRequest/received",
        request: {
          id: message.id,
          method: message.method,
          threadId,
          turnId: typeof params.turnId === "string" ? params.turnId : undefined,
          params,
        },
        at,
      };
  }
}

export function reduceRpcMessage(
  state: DashboardState,
  message: RpcInboundMessage,
  at?: number,
): DashboardState {
  const action = inboundMessageAction(message, at);
  return action === undefined ? state : dashboardReducer(state, action);
}

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  if (action.type === "rpc/message") {
    return reduceRpcMessage(state, action.message, action.at);
  }

  if (action.type === "connection/changed") {
    const connectionError = action.connection === "error" ? action.error : undefined;
    return { ...state, connection: action.connection, connectionError };
  }

  if (action.type === "thread/list") {
    let next: DashboardState = action.replace ? { ...state, sessions: {} } : state;
    // A list is a historical snapshot, so each thread's own recency timestamp is
    // more meaningful than the instant at which the page happened to arrive.
    for (const thread of action.threads) next = applyThreadUpsert(next, thread, undefined);
    return next;
  }

  if (action.type === "thread/upsert") {
    return applyThreadUpsert(state, action.thread, action.at);
  }

  if (action.type === "thread/archive" || action.type === "thread/delete") {
    if (state.sessions[action.threadId] === undefined) return state;
    const sessions = { ...state.sessions };
    delete sessions[action.threadId];
    return { ...state, sessions };
  }

  const at = actionTime(action.at);

  if (action.type === "thread/status") {
    const previous = ensureSession(state, action.threadId, at);
    const wasWaiting = previous.pendingRequests.length > 0 || (
      previous.thread.status.type === "active" &&
      previous.thread.status.activeFlags.length > 0
    );
    const isWaiting =
      action.status.type === "active" && action.status.activeFlags.includes("waitingOnUserInput");
    const isApproval =
      action.status.type === "active" && action.status.activeFlags.includes("waitingOnApproval");
    const activity = isWaiting
      ? "Waiting for your input"
      : isApproval
        ? "Waiting for approval"
        : action.status.type === "systemError"
          ? "System error"
          : wasWaiting && action.status.type !== "active"
            ? latestActivity(previous.turns) || previous.latestText
            : previous.activity;
    return withSession(state, action.threadId, {
      ...previous,
      thread: { ...touchThread(previous.thread, at), status: action.status },
      activity,
      pendingRequests: action.status.type === "active" ? previous.pendingRequests : [],
      lastChangedAt: at,
    });
  }

  if (action.type === "thread/name") {
    const previous = ensureSession(state, action.threadId, at);
    return withSession(state, action.threadId, {
      ...previous,
      thread: { ...touchThread(previous.thread, at), name: action.name },
      lastChangedAt: at,
    });
  }

  if (action.type === "turn/started") {
    const previous = ensureSession(state, action.threadId, at);
    const incoming = { ...action.turn, status: "inProgress" as const };
    const oldTurn = previous.turns.find((turn) => turn.id === incoming.id);
    const turns = replaceTurn(previous.turns, mergeTurn(oldTurn, incoming));
    return withSession(state, action.threadId, {
      ...withTurns(previous, turns),
      thread: {
        ...touchThread(previous.thread, at),
        turns,
        status: { type: "active", activeFlags: [] },
      },
      activeTurnId: incoming.id,
      activity: latestActivity([incoming]) || "Working…",
      plan: [],
      diff: "",
      pendingRequests: [],
      lastChangedAt: at,
    });
  }

  if (action.type === "turn/completed") {
    const previous = ensureSession(state, action.threadId, at);
    const oldTurn = previous.turns.find((turn) => turn.id === action.turn.id);
    const completed = mergeTurn(oldTurn, action.turn);
    const turns = replaceTurn(previous.turns, completed);
    const latestText = latestAgentText(turns) || previous.latestText;
    const failedActivity =
      completed.status === "failed" ? compactText(completed.error?.message ?? "Turn failed") : "";
    const remainingActiveTurn = turns.findLast((turn) => turn.status === "inProgress");
    const next = withTurns(previous, turns);
    return withSession(state, action.threadId, {
      ...next,
      thread: {
        ...touchThread(previous.thread, at),
        turns,
        status: remainingActiveTurn === undefined
          ? { type: "idle" }
          : previous.thread.status.type === "active"
            ? previous.thread.status
            : { type: "active", activeFlags: [] },
      },
      activeTurnId: remainingActiveTurn?.id,
      latestText,
      activity: failedActivity || latestText || latestActivity(turns) || previous.activity,
      pendingRequests: previous.pendingRequests.filter((request) => request.turnId !== completed.id),
      lastChangedAt: at,
    });
  }

  if (action.type === "turn/plan") {
    const previous = ensureSession(state, action.threadId, at);
    const currentStep = action.plan.find((step) => step.status === "inProgress");
    return withSession(state, action.threadId, {
      ...previous,
      plan: action.plan.map((step) => ({ ...step })),
      activity: currentStep?.step ?? previous.activity,
      lastChangedAt: at,
    });
  }

  if (action.type === "turn/diff") {
    const previous = ensureSession(state, action.threadId, at);
    return withSession(state, action.threadId, {
      ...previous,
      diff: action.diff,
      lastChangedAt: at,
    });
  }

  if (
    action.type === "item/started" ||
    action.type === "item/updated" ||
    action.type === "item/completed"
  ) {
    const previous = ensureSession(state, action.threadId, at);
    const oldTurn = previous.turns.find((turn) => turn.id === action.turnId);
    const turn: Turn = oldTurn ?? { id: action.turnId, status: "inProgress", items: [] };
    const itemIndex = turn.items.findIndex((item) => item.id === action.item.id);
    const items = [...turn.items];
    if (itemIndex === -1) items.push(action.item);
    else items[itemIndex] = { ...items[itemIndex], ...action.item } as ThreadItem;
    const nextTurn = { ...turn, items };
    const turns = replaceTurn(previous.turns, nextTurn);
    const next = withTurns(previous, turns);
    const text = action.item.type === "agentMessage" ? compactText(action.item.text ?? "") : "";
    return withSession(state, action.threadId, {
      ...next,
      thread: {
        ...touchThread(previous.thread, at),
        turns,
        status: { type: "active", activeFlags: previous.thread.status.type === "active"
          ? previous.thread.status.activeFlags
          : [] },
      },
      activeTurnId: action.turnId,
      latestText: text || previous.latestText,
      activity: itemActivity(action.item) || previous.activity,
      lastChangedAt: at,
    });
  }

  if (action.type === "item/delta") {
    const previous = ensureSession(state, action.threadId, at);
    const oldTurn = previous.turns.find((turn) => turn.id === action.turnId) ?? {
      id: action.turnId,
      status: "inProgress" as const,
      items: [],
      itemsView: "notLoaded" as const,
    };
    let itemIndex = oldTurn.items.findIndex((item) => item.id === action.itemId);
    const items = [...oldTurn.items];
    if (itemIndex === -1) {
      items.push({
        id: action.itemId,
        type: action.itemType ?? (action.field === "aggregatedOutput" ? "commandExecution" : "agentMessage"),
      });
      itemIndex = items.length - 1;
    }
    const oldItem = items[itemIndex];
    if (oldItem === undefined) return state;
    const field = action.field ?? "text";
    const oldValue = typeof oldItem[field] === "string" ? oldItem[field] : "";
    const item = { ...oldItem, [field]: oldValue + action.delta } as ThreadItem;
    items[itemIndex] = item;
    const turns = replaceTurn(previous.turns, { ...oldTurn, items });
    const next = withTurns(previous, turns);
    const text = item.type === "agentMessage" ? compactText(item.text ?? "") : "";
    return withSession(state, action.threadId, {
      ...next,
      thread: { ...touchThread(previous.thread, at), turns },
      latestText: text || previous.latestText,
      activity: field === "text" ? itemActivity(item) : previous.activity,
      lastChangedAt: at,
    });
  }

  if (action.type === "item/reasoningSummaryDelta") {
    const previous = ensureSession(state, action.threadId, at);
    const oldTurn = previous.turns.find((turn) => turn.id === action.turnId) ?? {
      id: action.turnId,
      status: "inProgress" as const,
      items: [],
      itemsView: "notLoaded" as const,
    };
    const items = [...oldTurn.items];
    let itemIndex = items.findIndex((item) => item.id === action.itemId);
    if (itemIndex === -1) {
      items.push({ id: action.itemId, type: "reasoning", summary: [] });
      itemIndex = items.length - 1;
    }
    const previousItem = items[itemIndex] ?? { id: action.itemId, type: "reasoning" };
    const summary = Array.isArray(previousItem.summary)
      ? previousItem.summary.map((value) => typeof value === "string" ? value : "")
      : [];
    while (summary.length <= action.summaryIndex) summary.push("");
    summary[action.summaryIndex] = (summary[action.summaryIndex] ?? "") + (action.delta ?? "");
    const item = { ...previousItem, type: "reasoning", summary } as ThreadItem;
    items[itemIndex] = item;
    const turns = replaceTurn(previous.turns, { ...oldTurn, items });
    const next = withTurns(previous, turns);
    return withSession(state, action.threadId, {
      ...next,
      thread: { ...touchThread(previous.thread, at), turns },
      activeTurnId: action.turnId,
      activity: compactText(summary[action.summaryIndex] || "Reasoning…"),
      lastChangedAt: at,
    });
  }

  if (action.type === "item/filePatch" || action.type === "item/mcpProgress") {
    const previous = ensureSession(state, action.threadId, at);
    const oldTurn = previous.turns.find((turn) => turn.id === action.turnId) ?? {
      id: action.turnId,
      status: "inProgress" as const,
      items: [],
      itemsView: "notLoaded" as const,
    };
    const items = [...oldTurn.items];
    let itemIndex = items.findIndex((item) => item.id === action.itemId);
    if (itemIndex === -1) {
      items.push({
        id: action.itemId,
        type: action.type === "item/filePatch" ? "fileChange" : "mcpToolCall",
      });
      itemIndex = items.length - 1;
    }
    const previousItem = items[itemIndex];
    if (previousItem === undefined) return state;
    const item = action.type === "item/filePatch"
      ? { ...previousItem, changes: action.changes }
      : { ...previousItem, progress: action.message };
    items[itemIndex] = item;
    const turns = replaceTurn(previous.turns, { ...oldTurn, items });
    const next = withTurns(previous, turns);
    return withSession(state, action.threadId, {
      ...next,
      thread: { ...touchThread(previous.thread, at), turns },
      activeTurnId: action.turnId,
      activity: action.type === "item/filePatch"
        ? "Applying file changes…"
        : compactText(action.message),
      lastChangedAt: at,
    });
  }

  if (action.type === "turn/error") {
    const previous = ensureSession(state, action.threadId, at);
    const oldTurn = previous.turns.find((turn) => turn.id === action.turnId) ?? {
      id: action.turnId,
      status: "inProgress" as const,
      items: [],
    };
    const turn: Turn = {
      ...oldTurn,
      error: { ...oldTurn.error, message: action.message },
    };
    const turns = replaceTurn(previous.turns, turn);
    const next = withTurns(previous, turns);
    return withSession(state, action.threadId, {
      ...next,
      thread: { ...touchThread(previous.thread, at), turns },
      activity: action.willRetry
        ? `Retrying after error: ${compactText(action.message)}`
        : compactText(action.message),
      lastChangedAt: at,
    });
  }

  if (action.type === "serverRequest/received") {
    const previous = ensureSession(state, action.request.threadId, at);
    const pendingRequests = previous.pendingRequests.some((request) => request.id === action.request.id)
      ? previous.pendingRequests.map((request) =>
          request.id === action.request.id ? action.request : request,
        )
      : [...previous.pendingRequests, action.request];
    const waitingFlag = action.request.method === "item/tool/requestUserInput"
      ? "waitingOnUserInput" as const
      : "waitingOnApproval" as const;
    return withSession(state, action.request.threadId, {
      ...previous,
      thread: {
        ...touchThread(previous.thread, at),
        status: { type: "active", activeFlags: [waitingFlag] },
      },
      activeTurnId: action.request.turnId ?? previous.activeTurnId,
      activity: requestActivity(action.request),
      pendingRequests,
      lastChangedAt: at,
    });
  }

  if (action.type === "serverRequest/resolved") {
    const candidateIds = action.threadId === undefined ? Object.keys(state.sessions) : [action.threadId];
    let next = state;
    for (const threadId of candidateIds) {
      const previous = next.sessions[threadId];
      if (previous === undefined) continue;
      const pendingRequests = previous.pendingRequests.filter(
        (request) => request.id !== action.requestId,
      );
      if (pendingRequests.length === previous.pendingRequests.length) continue;
      const nextRequest = pendingRequests.at(-1);
      const activeFlags = pendingRequests.map((request) =>
        request.method === "item/tool/requestUserInput"
          ? "waitingOnUserInput" as const
          : "waitingOnApproval" as const,
      ).filter((flag, index, flags) => flags.indexOf(flag) === index);
      next = withSession(next, threadId, {
        ...previous,
        thread: previous.thread.status.type === "active"
          ? { ...previous.thread, status: { type: "active", activeFlags } }
          : previous.thread,
        activity: nextRequest === undefined
          ? latestActivity(previous.turns) || previous.latestText || "Working…"
          : requestActivity(nextRequest),
        pendingRequests,
        lastChangedAt: at,
      });
    }
    return next;
  }

  return state;
}
