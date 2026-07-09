import { describe, expect, it } from "vitest";
import type { PendingRequest } from "../src/domain/types.js";
import { buildServerRequestResponse } from "../src/request-resolution.js";

function request(method: string, params: Record<string, unknown> = {}): PendingRequest {
  return { id: 1, method, threadId: "thread-1", params };
}

describe("buildServerRequestResponse", () => {
  it("answers request_user_input with the protocol answer map", () => {
    expect(
      buildServerRequestResponse(request("item/tool/requestUserInput"), {
        kind: "userInput",
        answers: { choice: { answers: ["One"] } },
      }),
    ).toEqual({
      type: "result",
      value: { answers: { choice: { answers: ["One"] } } },
    });
  });

  it("answers command approvals", () => {
    expect(
      buildServerRequestResponse(request("item/commandExecution/requestApproval"), {
        kind: "approval",
        decision: "acceptForSession",
      }),
    ).toEqual({ type: "result", value: { decision: "acceptForSession" } });
  });

  it("grants only requested permissions", () => {
    expect(
      buildServerRequestResponse(
        request("item/permissions/requestApproval", {
          permissions: {
            network: { enabled: true },
            fileSystem: { read: ["/tmp"], write: null },
          },
        }),
        { kind: "approval", decision: "accept" },
      ),
    ).toEqual({
      type: "result",
      value: {
        permissions: {
          network: { enabled: true },
          fileSystem: { read: ["/tmp"], write: null },
        },
        scope: "turn",
      },
    });
  });

  it("preserves boolean permission scopes exactly", () => {
    expect(
      buildServerRequestResponse(
        request("item/permissions/requestApproval", {
          permissions: { network: true, fileSystem: false, ignored: "no" },
        }),
        { kind: "approval", decision: "acceptForSession" },
      ),
    ).toEqual({
      type: "result",
      value: {
        permissions: { network: true, fileSystem: false },
        scope: "session",
      },
    });
  });

  it("declines unsupported requests with an RPC error", () => {
    expect(
      buildServerRequestResponse(request("item/tool/call"), {
        kind: "approval",
        decision: "decline",
      }),
    ).toMatchObject({ type: "error", code: -32_000 });
  });
});
