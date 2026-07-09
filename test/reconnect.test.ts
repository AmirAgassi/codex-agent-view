import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReconnectLoop,
  reconnectDelayMs,
} from "../src/state/reconnect.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("reconnect loop", () => {
  it("uses bounded exponential backoff", () => {
    expect(reconnectDelayMs(-1, 1_000, 8_000)).toBe(1_000);
    expect(reconnectDelayMs(0, 1_000, 8_000)).toBe(1_000);
    expect(reconnectDelayMs(1, 1_000, 8_000)).toBe(2_000);
    expect(reconnectDelayMs(2, 1_000, 8_000)).toBe(4_000);
    expect(reconnectDelayMs(3, 1_000, 8_000)).toBe(8_000);
    expect(reconnectDelayMs(100, 1_000, 8_000)).toBe(8_000);
  });

  it("retries every failed attempt and stops after success", async () => {
    vi.useFakeTimers();
    const attempt = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const loop = createReconnectLoop({
      attempt,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(400);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(loop.running).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("waits for operation gating without consuming backoff", async () => {
    vi.useFakeTimers();
    let blocked = true;
    const attempt = vi.fn().mockResolvedValue(true);
    const loop = createReconnectLoop({
      attempt,
      isBlocked: () => blocked,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      blockedDelayMs: 25,
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(attempt).not.toHaveBeenCalled();
    blocked = false;
    await vi.advanceTimersByTimeAsync(25);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(loop.running).toBe(false);
  });

  it("cancels pending and in-flight retries", async () => {
    vi.useFakeTimers();
    let resolveAttempt: ((value: boolean) => void) | undefined;
    const attempt = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveAttempt = resolve;
    }));
    const loop = createReconnectLoop({
      attempt,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(attempt).toHaveBeenCalledTimes(1);
    loop.stop();
    resolveAttempt?.(false);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(loop.running).toBe(false);
  });

  it("restarting invalidates the previous schedule and resets delay", async () => {
    vi.useFakeTimers();
    const attempt = vi.fn().mockResolvedValue(true);
    const loop = createReconnectLoop({ attempt, baseDelayMs: 100, maxDelayMs: 1_000 });

    loop.start();
    await vi.advanceTimersByTimeAsync(50);
    loop.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(attempt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
