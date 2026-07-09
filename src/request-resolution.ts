import type { PendingRequest } from "./domain/types.js";
import type { RequestResolution } from "./ui/index.js";

export type ServerRequestResponse =
  | { type: "result"; value: unknown }
  | { type: "error"; code: number; message: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function grantedPermissions(request: PendingRequest): Record<string, unknown> {
  const requested = asRecord(request.params.permissions);
  if (!requested) return {};
  const granted: Record<string, unknown> = {};
  if ("network" in requested) granted.network = requested.network;
  if ("fileSystem" in requested) granted.fileSystem = requested.fileSystem;
  return granted;
}

export function buildServerRequestResponse(
  request: PendingRequest,
  resolution: RequestResolution,
): ServerRequestResponse {
  if (resolution.kind === "userInput") {
    return { type: "result", value: { answers: resolution.answers } };
  }

  if (
    request.method === "item/commandExecution/requestApproval" ||
    request.method === "item/fileChange/requestApproval"
  ) {
    return { type: "result", value: { decision: resolution.decision } };
  }

  if (request.method === "item/permissions/requestApproval") {
    const accepted =
      resolution.decision === "accept" || resolution.decision === "acceptForSession";
    return {
      type: "result",
      value: {
        permissions: accepted ? grantedPermissions(request) : {},
        scope: resolution.decision === "acceptForSession" ? "session" : "turn",
      },
    };
  }

  if (request.method === "mcpServer/elicitation/request") {
    const action = resolution.decision === "decline" ? "decline" : "cancel";
    return { type: "result", value: { action, content: null } };
  }

  return {
    type: "error",
    code: -32_000,
    message: `Unsupported request declined by Codex Agents View: ${request.method}`,
  };
}
