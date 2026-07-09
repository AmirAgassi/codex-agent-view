import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";

import WebSocket from "ws";

export interface TransportClose {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface CodexTransport {
  start(): Promise<void>;
  write(data: string): Promise<void>;
  close(): void;
  onData(listener: (chunk: Buffer | string) => void): () => void;
  onStderr(listener: (chunk: Buffer | string) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onClose(listener: (close: TransportClose) => void): () => void;
}

interface ProcessTransportEvents {
  data: [Buffer | string];
  stderr: [Buffer | string];
  error: [Error];
  close: [TransportClose];
}

export interface ProcessTransportOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * A message transport backed by `codex app-server proxy`.
 *
 * The proxy is deliberately byte-transparent: its stdio stream carries an
 * HTTP Upgrade followed by WebSocket frames, not JSONL. This adapter performs
 * that WebSocket handshake over the child process pipes and presents JSONL-like
 * chunks to CodexClient so fake and process transports share one interface.
 */
export class ProcessCodexTransport implements CodexTransport {
  readonly #events = new EventEmitter<ProcessTransportEvents>();
  readonly #options: Required<Pick<ProcessTransportOptions, "command" | "args">> &
    Omit<ProcessTransportOptions, "command" | "args">;
  #child?: ChildProcessWithoutNullStreams;
  #socket?: Duplex;
  #websocket?: WebSocket;
  #startPromise?: Promise<void>;
  #closed = false;
  #closeEmitted = false;

  constructor(options: ProcessTransportOptions = {}) {
    this.#options = {
      command: options.command ?? "codex",
      args: options.args ?? ["app-server", "proxy"],
      cwd: options.cwd,
      env: options.env,
    };
  }

  start(): Promise<void> {
    if (this.#startPromise) return this.#startPromise;

    this.#startPromise = new Promise<void>((resolve, reject) => {
      if (this.#closed) {
        reject(new Error("Cannot start a closed Codex transport"));
        return;
      }

      const child = spawn(this.#options.command, this.#options.args, {
        cwd: this.#options.cwd,
        env: this.#options.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.#child = child;

      let settled = false;
      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
        this.#events.emit("error", error);
      };

      child.once("error", fail);
      child.stderr.on("data", (chunk: Buffer) => this.#events.emit("stderr", chunk));
      child.once("close", (code, signal) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Codex app-server proxy exited before connecting (code ${code ?? "?"})`));
        }
        this.#emitClose({ code, signal });
      });

      child.once("spawn", () => {
        const socket = Duplex.from({ readable: child.stdout, writable: child.stdin });
        this.#socket = socket;
        const websocket = new WebSocket("ws://localhost/rpc", {
          createConnection: () => socket,
          handshakeTimeout: 10_000,
          perMessageDeflate: false,
        });
        this.#websocket = websocket;

        websocket.on("message", (data) => {
          const text = typeof data === "string"
            ? data
            : Array.isArray(data)
              ? Buffer.concat(data).toString("utf8")
              : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString("utf8");
          this.#events.emit("data", `${text}\n`);
        });
        websocket.once("open", () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        websocket.on("error", fail);
        websocket.once("close", () => {
          if (!settled) {
            settled = true;
            reject(new Error("Codex app-server WebSocket closed during handshake"));
          }
          this.#emitClose({ code: child.exitCode, signal: child.signalCode });
        });
      });
    });

    return this.#startPromise;
  }

  async write(data: string): Promise<void> {
    const websocket = this.#websocket;
    if (!websocket || !this.#startPromise || this.#closed) {
      throw new Error("Codex transport is not running");
    }
    await this.#startPromise;

    await new Promise<void>((resolve, reject) => {
      const message = data.endsWith("\n") ? data.slice(0, -1) : data;
      websocket.send(message, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#websocket?.terminate();
    this.#socket?.destroy();
    const child = this.#child;
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }

  onData(listener: (chunk: Buffer | string) => void): () => void {
    this.#events.on("data", listener);
    return () => this.#events.off("data", listener);
  }

  onStderr(listener: (chunk: Buffer | string) => void): () => void {
    this.#events.on("stderr", listener);
    return () => this.#events.off("stderr", listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.#events.on("error", listener);
    return () => this.#events.off("error", listener);
  }

  onClose(listener: (close: TransportClose) => void): () => void {
    this.#events.on("close", listener);
    return () => this.#events.off("close", listener);
  }

  #emitClose(close: TransportClose): void {
    if (this.#closeEmitted) return;
    this.#closeEmitted = true;
    this.#events.emit("close", close);
  }
}
