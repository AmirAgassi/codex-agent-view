import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  CodexClient,
  CodexConnectionClosedError,
  CodexRpcError,
  type CodexTransport,
  type TransportClose,
} from "../src/codex/index.js";

interface FakeEvents {
  data: [Buffer | string];
  stderr: [Buffer | string];
  error: [Error];
  close: [TransportClose];
}

class FakeTransport implements CodexTransport {
  readonly writes: Array<Record<string, unknown>> = [];
  readonly events = new EventEmitter<FakeEvents>();
  started = false;
  closed = false;
  onWrite?: (message: Record<string, unknown>) => void;

  async start(): Promise<void> {
    this.started = true;
  }

  async write(data: string): Promise<void> {
    const message = JSON.parse(data) as Record<string, unknown>;
    this.writes.push(message);
    this.onWrite?.(message);
  }

  close(): void {
    this.closed = true;
  }

  send(message: unknown, splitAt?: number): void {
    const line = `${JSON.stringify(message)}\n`;
    if (splitAt === undefined) {
      this.events.emit("data", Buffer.from(line));
      return;
    }
    const bytes = Buffer.from(line);
    this.events.emit("data", bytes.subarray(0, splitAt));
    this.events.emit("data", bytes.subarray(splitAt));
  }

  onData(listener: (chunk: Buffer | string) => void): () => void {
    this.events.on("data", listener);
    return () => this.events.off("data", listener);
  }

  onStderr(listener: (chunk: Buffer | string) => void): () => void {
    this.events.on("stderr", listener);
    return () => this.events.off("stderr", listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.events.on("error", listener);
    return () => this.events.off("error", listener);
  }

  onClose(listener: (close: TransportClose) => void): () => void {
    this.events.on("close", listener);
    return () => this.events.off("close", listener);
  }
}

function connectedHarness(): {
  client: CodexClient;
  transport: FakeTransport;
  ensureDaemon: ReturnType<typeof vi.fn>;
} {
  const transport = new FakeTransport();
  const ensureDaemon = vi.fn(async () => undefined);
  transport.onWrite = (message) => {
    if (message.method === "initialize") {
      queueMicrotask(() => transport.send({
        id: message.id,
        result: {
          userAgent: "codex-test",
          codexHome: "/tmp/codex",
          platformFamily: "unix",
          platformOs: "macos",
        },
      }));
    }
  };
  const client = new CodexClient({
    ensureDaemon,
    transportFactory: () => transport,
    requestTimeoutMs: 1_000,
  });
  return { client, transport, ensureDaemon };
}

describe("CodexClient", () => {
  it("starts the daemon and performs initialize/initialized in order", async () => {
    const { client, transport, ensureDaemon } = connectedHarness();

    await expect(client.connect()).resolves.toMatchObject({ userAgent: "codex-test" });

    expect(ensureDaemon).toHaveBeenCalledOnce();
    expect(transport.started).toBe(true);
    expect(transport.writes.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
    ]);
    expect(transport.writes[0]).toMatchObject({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "codex_agent_view", title: "Codex Agent View", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    });
    expect(client.state).toBe("connected");
    client.close();
  });

  it("correlates out-of-order responses and preserves UTF-8 across chunks", async () => {
    const { client, transport } = connectedHarness();
    await client.connect();

    const first = client.request<{ value: string }>("test/first");
    const second = client.request<{ value: string }>("test/second");
    const firstRequest = transport.writes.at(-2)!;
    const secondRequest = transport.writes.at(-1)!;

    const secondLine = Buffer.from(JSON.stringify({
      id: secondRequest.id,
      result: { value: "café 🚀" },
    }) + "\n");
    const rocketByte = secondLine.indexOf(Buffer.from("🚀")) + 2;
    transport.events.emit("data", secondLine.subarray(0, rocketByte));
    transport.events.emit("data", secondLine.subarray(rocketByte));
    transport.send({ id: firstRequest.id, result: { value: "first" } });

    await expect(second).resolves.toEqual({ value: "café 🚀" });
    await expect(first).resolves.toEqual({ value: "first" });
    client.close();
  });

  it("emits notifications and server-initiated requests", async () => {
    const { client, transport } = connectedHarness();
    await client.connect();
    const notification = vi.fn();
    const serverRequest = vi.fn();
    client.on("notification", notification);
    client.on("serverRequest", serverRequest);

    transport.send({ method: "turn/started", params: { threadId: "thread-1" } });
    transport.send({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1" },
    });

    expect(notification).toHaveBeenCalledWith({
      method: "turn/started",
      params: { threadId: "thread-1" },
    });
    expect(serverRequest).toHaveBeenCalledWith({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1" },
    });
    client.close();
  });

  it("turns RPC errors into CodexRpcError", async () => {
    const { client, transport } = connectedHarness();
    await client.connect();

    const request = client.request("thread/read", { threadId: "missing" });
    const sent = transport.writes.at(-1)!;
    transport.send({
      id: sent.id,
      error: { code: -32602, message: "thread not found", data: { threadId: "missing" } },
    });

    await expect(request).rejects.toMatchObject<CodexRpcError>({
      name: "CodexRpcError",
      method: "thread/read",
      code: -32602,
      data: { threadId: "missing" },
    });
    client.close();
  });

  it("sends typed convenience methods and server-request responses", async () => {
    const { client, transport } = connectedHarness();
    await client.connect();

    const turn = client.startTurn("thread-1", "Run the tests", { cwd: "/repo" });
    const turnRequest = transport.writes.at(-1)!;
    expect(turnRequest).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [{ type: "text", text: "Run the tests" }],
        cwd: "/repo",
      },
    });
    transport.send({
      id: turnRequest.id,
      result: { turn: { id: "turn-1", status: "inProgress", items: [], error: null } },
    });
    await expect(turn).resolves.toMatchObject({ turn: { id: "turn-1" } });

    await client.respond("approval-1", { decision: "accept" });
    await client.respondError("approval-2", { code: -32603, message: "cancelled" });
    expect(transport.writes.slice(-2)).toEqual([
      { id: "approval-1", result: { decision: "accept" } },
      { id: "approval-2", error: { code: -32603, message: "cancelled" } },
    ]);
    client.close();
  });

  it("rejects in-flight requests when the proxy disconnects", async () => {
    const { client, transport } = connectedHarness();
    await client.connect();
    const disconnect = vi.fn();
    client.on("disconnect", disconnect);

    const pending = client.request("thread/list");
    transport.events.emit("close", { code: 1, signal: null });

    await expect(pending).rejects.toBeInstanceOf(CodexConnectionClosedError);
    expect(disconnect).toHaveBeenCalledWith({ code: 1, signal: null });
    expect(client.state).toBe("disconnected");
  });
});
