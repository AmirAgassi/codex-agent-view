export const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
export const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
export const DEFAULT_RECONNECT_BLOCKED_DELAY_MS = 500;

export interface ReconnectLoopOptions {
  attempt: () => Promise<boolean>;
  isBlocked?: () => boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
  blockedDelayMs?: number;
}

export interface ReconnectLoop {
  readonly running: boolean;
  start(): void;
  stop(): void;
}

export function reconnectDelayMs(
  attempt: number,
  baseDelayMs = DEFAULT_RECONNECT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_RECONNECT_MAX_DELAY_MS,
): number {
  const safeAttempt = Math.max(0, Math.min(30, Math.floor(attempt)));
  const safeBase = Math.max(1, Math.floor(baseDelayMs));
  const safeMaximum = Math.max(safeBase, Math.floor(maxDelayMs));
  return Math.min(safeMaximum, safeBase * (2 ** safeAttempt));
}

/**
 * A single-owner, cancellable reconnect scheduler. `start` resets the backoff,
 * `stop` invalidates both pending timers and in-flight attempts, and operation
 * blocking polls without consuming a retry attempt.
 */
export function createReconnectLoop(options: ReconnectLoopOptions): ReconnectLoop {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
  const blockedDelayMs = Math.max(
    1,
    Math.floor(options.blockedDelayMs ?? DEFAULT_RECONNECT_BLOCKED_DELAY_MS),
  );
  let timer: NodeJS.Timeout | undefined;
  let generation = 0;
  let attempt = 0;
  let running = false;

  const clearTimer = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (delayMs: number, expectedGeneration: number): void => {
    if (!running || expectedGeneration !== generation) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void run(expectedGeneration);
    }, delayMs);
    timer.unref();
  };

  const run = async (expectedGeneration: number): Promise<void> => {
    if (!running || expectedGeneration !== generation) return;
    if (options.isBlocked?.()) {
      schedule(blockedDelayMs, expectedGeneration);
      return;
    }

    let succeeded = false;
    try {
      succeeded = await options.attempt();
    } catch {
      succeeded = false;
    }
    if (!running || expectedGeneration !== generation) return;
    if (succeeded) {
      running = false;
      attempt = 0;
      return;
    }

    attempt = Math.min(30, attempt + 1);
    schedule(reconnectDelayMs(attempt, baseDelayMs, maxDelayMs), expectedGeneration);
  };

  return {
    get running(): boolean {
      return running;
    },
    start(): void {
      generation += 1;
      attempt = 0;
      running = true;
      schedule(reconnectDelayMs(attempt, baseDelayMs, maxDelayMs), generation);
    },
    stop(): void {
      generation += 1;
      running = false;
      attempt = 0;
      clearTimer();
    },
  };
}
