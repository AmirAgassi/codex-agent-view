import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";

import type {
  JsonRpcId,
  RpcNotification,
  RpcResponse,
  RpcServerRequest,
} from "../domain/types.js";
import {
  ProcessCodexTransport,
  type CodexTransport,
  type TransportClose,
} from "./transport.js";
import type {
  ClientInfo,
  EmptyResult,
  InitializeCapabilities,
  InitializeResult,
  RpcErrorBody,
  ServerRequestReference,
  ThreadListParams,
  ThreadListResult,
  ThreadReadResult,
  ThreadResumeOptions,
  ThreadSessionResult,
  ThreadStartParams,
  TurnStartOptions,
  TurnStartParams,
  TurnStartResult,
  TurnSteerResult,
  UserInput,
} from "./types.js";

const execFileAsync = promisify(execFile);

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "closing";

export interface CodexClientOptions {
  codexCommand?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  clientInfo?: Partial<ClientInfo>;
  capabilities?: Partial<InitializeCapabilities> | null;
  requestTimeoutMs?: number;
  daemonStartTimeoutMs?: number;
  maxMessageBytes?: number;
  /** Test/integration hook. When supplied, it replaces `codex app-server daemon start`. */
  ensureDaemon?: () => Promise<void>;
  /** Test/integration hook. The returned transport is owned and closed by this client. */
  transportFactory?: () => CodexTransport;
}

interface PendingRpc {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

interface CodexClientEvents {
  connected: [InitializeResult];
  notification: [RpcNotification];
  serverRequest: [RpcServerRequest];
  stderr: [string];
  protocolError: [Error, string?];
  error: [Error];
  disconnect: [TransportClose];
}

export class CodexRpcError extends Error {
  readonly method: string;
  readonly requestId: JsonRpcId;
  readonly code: number;
  readonly data?: unknown;

  constructor(method: string, requestId: JsonRpcId, error: RpcErrorBody) {
    super(`${method} failed (${error.code}): ${error.message}`);
    this.name = "CodexRpcError";
    this.method = method;
    this.requestId = requestId;
    this.code = error.code;
    this.data = error.data;
  }
}

export class CodexRequestTimeoutError extends Error {
  readonly method: string;
  readonly requestId: JsonRpcId;

  constructor(method: string, requestId: JsonRpcId, timeoutMs: number) {
    super(`${method} timed out after ${timeoutMs}ms`);
    this.name = "CodexRequestTimeoutError";
    this.method = method;
    this.requestId = requestId;
  }
}

export class CodexConnectionClosedError extends Error {
  constructor(message = "Codex app-server connection closed") {
    super(message);
    this.name = "CodexConnectionClosedError";
  }
}

/**
 * Bidirectional JSON-RPC client for a persistent Codex app-server daemon.
 *
 * The client owns only the short-lived stdio proxy. Calling `close()` does not
 * stop the daemon or the Codex threads it hosts.
 */
export class CodexClient extends EventEmitter<CodexClientEvents> {
  readonly #options: Required<
    Pick<
      CodexClientOptions,
      "codexCommand" | "requestTimeoutMs" | "daemonStartTimeoutMs" | "maxMessageBytes"
    >
  > &
    Omit<
      CodexClientOptions,
      "codexCommand" | "requestTimeoutMs" | "daemonStartTimeoutMs" | "maxMessageBytes"
    >;
  readonly #pending = new Map<JsonRpcId, PendingRpc>();
  readonly #decoder = new StringDecoder("utf8");
  #transport?: CodexTransport;
  #unsubscribeTransport: Array<() => void> = [];
  #connectPromise?: Promise<InitializeResult>;
  #initializeResult?: InitializeResult;
  #state: ConnectionState = "disconnected";
  #nextId = 1;
  #buffer = "";
  #intentionalClose = false;

  constructor(options: CodexClientOptions = {}) {
    super();
    this.#options = {
      codexCommand: options.codexCommand ?? "codex",
      cwd: options.cwd,
      env: options.env,
      clientInfo: options.clientInfo,
      capabilities: options.capabilities,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      daemonStartTimeoutMs: options.daemonStartTimeoutMs ?? 30_000,
      maxMessageBytes: options.maxMessageBytes ?? 16 * 1024 * 1024,
      ensureDaemon: options.ensureDaemon,
      transportFactory: options.transportFactory,
    };

    // EventEmitter treats an unhandled `error` specially. Keep connection
    // failures promise-based even when callers do not subscribe to diagnostics.
    this.on("error", () => undefined);
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get initializeResult(): InitializeResult | undefined {
    return this.#initializeResult;
  }

  async connect(): Promise<InitializeResult> {
    if (this.#state === "connected" && this.#initializeResult) {
      return this.#initializeResult;
    }
    if (this.#connectPromise) return this.#connectPromise;

    this.#state = "connecting";
    this.#intentionalClose = false;
    this.#connectPromise = this.#doConnect();

    try {
      return await this.#connectPromise;
    } catch (error) {
      this.#teardownTransport();
      this.#state = "disconnected";
      throw error;
    } finally {
      this.#connectPromise = undefined;
    }
  }

  async #doConnect(): Promise<InitializeResult> {
    await this.#ensureDaemon();

    const transport = this.#options.transportFactory?.() ??
      new ProcessCodexTransport({
        command: this.#options.codexCommand,
        args: ["app-server", "proxy"],
        cwd: this.#options.cwd,
        env: this.#options.env,
      });
    this.#transport = transport;
    this.#subscribeTransport(transport);
    await transport.start();

    const clientInfo: ClientInfo = {
      name: this.#options.clientInfo?.name ?? "codex_agent_view",
      title: this.#options.clientInfo?.title ?? "Codex Agent View",
      version: this.#options.clientInfo?.version ?? "0.1.0",
    };
    const capabilities = this.#options.capabilities === null
      ? null
      : {
          experimentalApi: this.#options.capabilities?.experimentalApi ?? true,
          requestAttestation: this.#options.capabilities?.requestAttestation ?? false,
          ...(this.#options.capabilities?.mcpServerOpenaiFormElicitation === undefined
            ? {}
            : {
                mcpServerOpenaiFormElicitation:
                  this.#options.capabilities.mcpServerOpenaiFormElicitation,
              }),
          ...(this.#options.capabilities?.optOutNotificationMethods === undefined
            ? {}
            : {
                optOutNotificationMethods:
                  this.#options.capabilities.optOutNotificationMethods,
              }),
        } satisfies InitializeCapabilities;

    const result = await this.request<InitializeResult>("initialize", {
      clientInfo,
      capabilities,
    });
    await this.notify("initialized", {});

    this.#initializeResult = result;
    this.#state = "connected";
    this.emit("connected", result);
    return result;
  }

  async #ensureDaemon(): Promise<void> {
    if (this.#options.ensureDaemon) {
      await this.#options.ensureDaemon();
      return;
    }

    try {
      await execFileAsync(
        this.#options.codexCommand,
        ["app-server", "daemon", "start"],
        {
          cwd: this.#options.cwd,
          env: this.#options.env,
          timeout: this.#options.daemonStartTimeoutMs,
          maxBuffer: 1024 * 1024,
        },
      );
    } catch (cause) {
      throw new Error("Unable to start the Codex app-server daemon", { cause });
    }
  }

  #subscribeTransport(transport: CodexTransport): void {
    this.#unsubscribeTransport.push(
      transport.onData((chunk) => this.#onData(chunk)),
      transport.onStderr((chunk) => this.emit("stderr", chunk.toString())),
      transport.onError((error) => this.#onTransportError(error)),
      transport.onClose((close) => this.#onTransportClose(close)),
    );
  }

  #onData(chunk: Buffer | string): void {
    this.#buffer += typeof chunk === "string" ? chunk : this.#decoder.write(chunk);

    let newline = this.#buffer.indexOf("\n");
    while (newline !== -1) {
      const rawLine = this.#buffer.slice(0, newline).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(newline + 1);
      if (Buffer.byteLength(rawLine, "utf8") > this.#options.maxMessageBytes) {
        this.#messageTooLarge();
        return;
      }
      if (rawLine.trim()) this.#onLine(rawLine);
      newline = this.#buffer.indexOf("\n");
    }

    if (Buffer.byteLength(this.#buffer, "utf8") > this.#options.maxMessageBytes) {
      this.#messageTooLarge();
    }
  }

  #messageTooLarge(): void {
    const error = new Error(
      `Codex app-server message exceeded ${this.#options.maxMessageBytes} bytes`,
    );
    this.emit("protocolError", error);
    this.#failConnection(error);
  }

  #onLine(rawLine: string): void {
    let value: unknown;
    try {
      value = JSON.parse(rawLine);
    } catch (cause) {
      this.emit(
        "protocolError",
        new Error("Received invalid JSON from Codex app-server", { cause }),
        rawLine,
      );
      return;
    }

    if (!isRecord(value)) {
      this.emit("protocolError", new Error("Received a non-object JSON-RPC message"), rawLine);
      return;
    }

    if (typeof value.method === "string") {
      const params = isRecord(value.params) ? value.params : {};
      if (isJsonRpcId(value.id)) {
        this.emit("serverRequest", {
          id: value.id,
          method: value.method,
          params,
        });
      } else {
        this.emit("notification", { method: value.method, params });
      }
      return;
    }

    if (isJsonRpcId(value.id) && ("result" in value || "error" in value)) {
      this.#onResponse(value as unknown as RpcResponse);
      return;
    }

    this.emit("protocolError", new Error("Received an unknown JSON-RPC message"), rawLine);
  }

  #onResponse(response: RpcResponse): void {
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    this.#pending.delete(response.id);
    if (pending.timeout) clearTimeout(pending.timeout);

    if (response.error) {
      pending.reject(new CodexRpcError(pending.method, response.id, response.error));
    } else {
      pending.resolve(response.result);
    }
  }

  #onTransportError(error: Error): void {
    this.emit("error", error);
    this.#failPending(error);
    if (this.#state !== "closing") {
      this.#state = "disconnected";
      this.#transport?.close();
    }
  }

  #onTransportClose(close: TransportClose): void {
    const decoderTail = this.#decoder.end();
    if (decoderTail) this.#buffer += decoderTail;
    if (this.#buffer.trim()) this.#onLine(this.#buffer.replace(/\r$/, ""));
    this.#buffer = "";

    this.#failPending(new CodexConnectionClosedError());
    this.#teardownTransport(false);
    this.#state = "disconnected";
    if (!this.#intentionalClose) this.emit("disconnect", close);
  }

  #failConnection(error: Error): void {
    this.emit("error", error);
    this.#failPending(error);
    this.#transport?.close();
    this.#state = "disconnected";
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #teardownTransport(close = true): void {
    for (const unsubscribe of this.#unsubscribeTransport.splice(0)) unsubscribe();
    if (close) this.#transport?.close();
    this.#transport = undefined;
  }

  async #write(message: unknown): Promise<void> {
    const transport = this.#transport;
    if (!transport || this.#state === "disconnected" || this.#state === "closing") {
      throw new CodexConnectionClosedError("Codex app-server is not connected");
    }
    await transport.write(`${JSON.stringify(message)}\n`);
  }

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.#transport || this.#state === "disconnected" || this.#state === "closing") {
      return Promise.reject(
        new CodexConnectionClosedError("Call connect() before sending Codex requests"),
      );
    }

    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRpc = {
        method,
        resolve: (value) => resolve(value as T),
        reject,
      };
      if (this.#options.requestTimeoutMs > 0) {
        pending.timeout = setTimeout(() => {
          if (!this.#pending.delete(id)) return;
          reject(new CodexRequestTimeoutError(method, id, this.#options.requestTimeoutMs));
        }, this.#options.requestTimeoutMs);
        pending.timeout.unref();
      }
      this.#pending.set(id, pending);

      void this.#write({ method, id, params }).catch((error: unknown) => {
        if (!this.#pending.delete(id)) return;
        if (pending.timeout) clearTimeout(pending.timeout);
        reject(asError(error));
      });
    });
  }

  notify(method: string, params?: Record<string, unknown>): Promise<void> {
    return this.#write(params === undefined ? { method } : { method, params });
  }

  respond(request: ServerRequestReference, result: unknown): Promise<void> {
    return this.#write({ id: requestId(request), result });
  }

  respondError(request: ServerRequestReference, error: RpcErrorBody): Promise<void> {
    return this.#write({ id: requestId(request), error });
  }

  listThreads(params: ThreadListParams = {}): Promise<ThreadListResult> {
    return this.request("thread/list", params as Record<string, unknown>);
  }

  readThread(threadId: string, includeTurns = true): Promise<ThreadReadResult> {
    return this.request("thread/read", { threadId, includeTurns });
  }

  resumeThread(
    threadId: string,
    options: ThreadResumeOptions = {},
  ): Promise<ThreadSessionResult> {
    return this.request("thread/resume", { threadId, ...options });
  }

  startThread(params: ThreadStartParams = {}): Promise<ThreadSessionResult> {
    return this.request("thread/start", params);
  }

  startTurn(params: TurnStartParams): Promise<TurnStartResult>;
  startTurn(
    threadId: string,
    input: string | UserInput[],
    options?: TurnStartOptions,
  ): Promise<TurnStartResult>;
  startTurn(
    paramsOrThreadId: TurnStartParams | string,
    input?: string | UserInput[],
    options: TurnStartOptions = {},
  ): Promise<TurnStartResult> {
    const params = typeof paramsOrThreadId === "string"
      ? {
          threadId: paramsOrThreadId,
          input: normalizeInput(input ?? ""),
          ...options,
        }
      : paramsOrThreadId;
    return this.request("turn/start", params);
  }

  steerTurn(
    threadId: string,
    expectedTurnId: string,
    input: string | UserInput[],
    clientUserMessageId?: string,
  ): Promise<TurnSteerResult> {
    return this.request("turn/steer", {
      threadId,
      expectedTurnId,
      input: normalizeInput(input),
      ...(clientUserMessageId === undefined ? {} : { clientUserMessageId }),
    });
  }

  interruptTurn(threadId: string, turnId: string): Promise<EmptyResult> {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  renameThread(threadId: string, name: string): Promise<EmptyResult> {
    return this.request("thread/name/set", { threadId, name });
  }

  archiveThread(threadId: string): Promise<EmptyResult> {
    return this.request("thread/archive", { threadId });
  }

  deleteThread(threadId: string): Promise<EmptyResult> {
    return this.request("thread/delete", { threadId });
  }

  close(): void {
    if (this.#state === "closing" || this.#state === "disconnected") return;
    this.#state = "closing";
    this.#intentionalClose = true;
    this.#failPending(new CodexConnectionClosedError("Codex client closed"));
    this.#teardownTransport();
    this.#buffer = "";
    this.#state = "disconnected";
  }
}

function normalizeInput(input: string | UserInput[]): UserInput[] {
  return typeof input === "string" ? [{ type: "text", text: input }] : input;
}

function requestId(reference: ServerRequestReference): JsonRpcId {
  return typeof reference === "object" ? reference.id : reference;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value));
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
