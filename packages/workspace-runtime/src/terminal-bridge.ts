import { WorkspaceError } from "./errors.js";
import type { TerminalDiagnostic, TerminalSession } from "./terminal.js";

export type TerminalBridgeCloseCode =
  | "client_closed"
  | "process_exited"
  | "process_failed"
  | "backpressure_limit"
  | "transport_error";

export interface TerminalBridgeCloseReason {
  readonly code: TerminalBridgeCloseCode;
  readonly message?: string;
}

/** Transport-neutral output boundary implemented by the companion WebSocket adapter. */
export interface TerminalBinarySink {
  send(bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
  close(reason: TerminalBridgeCloseReason): Promise<void>;
}

export interface TerminalBridgeOptions {
  readonly session: TerminalSession;
  readonly sink: TerminalBinarySink;
  readonly maxQueuedBytes?: number;
  readonly closeTimeoutMs?: number;
  readonly maxInputBytes?: number;
  readonly maxQueuedInputBytes?: number;
  readonly onStatus?: (diagnostic: TerminalDiagnostic) => void;
}

/**
 * Serializes a terminal's push output into a bounded, backpressure-aware binary sink.
 * The sink owns WebSocket mechanics; this class owns queue limits and process cleanup.
 */
export class TerminalBridge {
  readonly #session: TerminalSession;
  readonly #sink: TerminalBinarySink;
  readonly #maxQueuedBytes: number;
  readonly #closeTimeoutMs: number;
  readonly #maxInputBytes: number;
  readonly #maxQueuedInputBytes: number;
  readonly #onStatus: ((diagnostic: TerminalDiagnostic) => void) | undefined;
  readonly #queue: Uint8Array[] = [];
  readonly #sendController = new AbortController();
  readonly #closed: Promise<TerminalBridgeCloseReason>;
  #resolveClosed: ((reason: TerminalBridgeCloseReason) => void) | undefined;
  #queuedBytes = 0;
  #queuedInputBytes = 0;
  #inputTail: Promise<void> = Promise.resolve();
  #state: "idle" | "open" | "closing" | "closed" = "idle";
  #flushPromise: Promise<void> | undefined;
  #closePromise: Promise<void> | undefined;
  #removeOutput: (() => void) | undefined;
  #removeDiagnostic: (() => void) | undefined;

  constructor(options: TerminalBridgeOptions) {
    this.#session = options.session;
    this.#sink = options.sink;
    this.#maxQueuedBytes = positiveInteger(options.maxQueuedBytes ?? 1024 * 1024, "maxQueuedBytes");
    this.#closeTimeoutMs = boundedInteger(
      options.closeTimeoutMs ?? 2_000,
      0,
      30_000,
      "closeTimeoutMs",
    );
    this.#maxInputBytes = positiveInteger(options.maxInputBytes ?? 1024 * 1024, "maxInputBytes");
    this.#maxQueuedInputBytes = positiveInteger(
      options.maxQueuedInputBytes ?? 1024 * 1024,
      "maxQueuedInputBytes",
    );
    this.#onStatus = options.onStatus;
    this.#closed = new Promise((resolve) => {
      this.#resolveClosed = resolve;
    });
  }

  get closed(): Promise<TerminalBridgeCloseReason> {
    return this.#closed;
  }

  start(): void {
    if (this.#state !== "idle")
      throw new WorkspaceError("terminal_bridge_closed", "Terminal bridge was already started");
    this.#state = "open";
    this.#removeOutput = this.#session.onOutput((bytes) => this.#enqueue(bytes));
    const removeDiagnostic = this.#session.onDiagnostic((diagnostic) => {
      try {
        this.#onStatus?.(diagnostic);
      } catch (cause) {
        this.#requestClose(
          {
            code: "transport_error",
            message: cause instanceof Error ? cause.message : "Terminal status transport failed",
          },
          false,
        );
        return;
      }
      if (diagnostic.state === "exited") {
        this.#requestClose({ code: "process_exited" }, true);
      } else if (diagnostic.state === "failed") {
        this.#requestClose(
          {
            code: "process_failed",
            ...(diagnostic.message === undefined ? {} : { message: diagnostic.message }),
          },
          false,
        );
      }
    });
    this.#removeDiagnostic = removeDiagnostic;
    // `onDiagnostic` reports current state synchronously. If that report closed the
    // bridge, the unsubscribe function did not exist yet when close began.
    if (this.#state !== "open") removeDiagnostic();
  }

  async input(bytes: Uint8Array): Promise<void> {
    this.#assertOpen();
    if (bytes.byteLength > this.#maxInputBytes) {
      throw new WorkspaceError(
        "resource_limit",
        "Terminal input frame exceeds its configured limit",
        {
          byteLength: bytes.byteLength,
          maxInputBytes: this.#maxInputBytes,
        },
      );
    }
    if (bytes.byteLength > this.#maxQueuedInputBytes - this.#queuedInputBytes) {
      throw new WorkspaceError("resource_limit", "Terminal input exceeded its queued byte limit", {
        byteLength: bytes.byteLength,
        queuedInputBytes: this.#queuedInputBytes,
        maxQueuedInputBytes: this.#maxQueuedInputBytes,
      });
    }
    const copy = Uint8Array.from(bytes);
    this.#queuedInputBytes += copy.byteLength;
    const operation = this.#inputTail
      .then(async () => {
        this.#assertOpen();
        await this.#session.write(copy);
      })
      .catch((cause: unknown) => {
        this.#requestClose(
          {
            code: "transport_error",
            message: cause instanceof Error ? cause.message : "Terminal input failed",
          },
          false,
        );
        throw cause;
      })
      .finally(() => {
        this.#queuedInputBytes -= copy.byteLength;
      });
    this.#inputTail = operation.catch(() => undefined);
    await operation;
  }

  async resize(columns: number, rows: number): Promise<void> {
    this.#assertOpen();
    await this.#session.resize(columns, rows);
  }

  close(reason: TerminalBridgeCloseReason = { code: "client_closed" }): Promise<void> {
    this.#requestClose(reason, false);
    return this.#closePromise ?? Promise.resolve();
  }

  #enqueue(bytes: Uint8Array): void {
    if (this.#state !== "open" || bytes.byteLength === 0) return;
    const copy = Uint8Array.from(bytes);
    if (copy.byteLength > this.#maxQueuedBytes - this.#queuedBytes) {
      this.#requestClose(
        { code: "backpressure_limit", message: "Terminal output exceeded the bridge queue limit" },
        false,
      );
      return;
    }
    this.#queue.push(copy);
    this.#queuedBytes += copy.byteLength;
    this.#flushPromise ??= this.#flush();
  }

  async #flush(): Promise<void> {
    try {
      while (this.#queue.length > 0) {
        const bytes = this.#queue[0];
        if (bytes === undefined) break;
        await this.#sink.send(bytes, this.#sendController.signal);
        this.#queue.shift();
        this.#queuedBytes -= bytes.byteLength;
      }
    } catch (cause) {
      if (!this.#sendController.signal.aborted) {
        this.#requestClose(
          {
            code: "transport_error",
            message: cause instanceof Error ? cause.message : "Terminal transport failed",
          },
          false,
        );
      }
    } finally {
      this.#flushPromise = undefined;
    }
  }

  #requestClose(reason: TerminalBridgeCloseReason, drainOutput: boolean): void {
    if (this.#closePromise !== undefined || this.#state === "closed") return;
    this.#state = "closing";
    this.#removeOutput?.();
    this.#removeDiagnostic?.();
    const closing = this.#finishClose(reason, drainOutput);
    // Lifecycle-triggered closes have no direct awaiter. Observe the rejection here
    // while preserving it for callers that explicitly await close().
    void closing.catch(() => undefined);
    this.#closePromise = closing;
  }

  async #finishClose(reason: TerminalBridgeCloseReason, drainOutput: boolean): Promise<void> {
    if (drainOutput && this.#flushPromise !== undefined) {
      await this.#waitForDrainOrTimeout(this.#flushPromise);
    }
    this.#sendController.abort();
    this.#queue.length = 0;
    this.#queuedBytes = 0;
    try {
      await this.#session.cancel({ graceMs: this.#closeTimeoutMs });
    } finally {
      try {
        await this.#sink.close(reason);
      } finally {
        this.#state = "closed";
        this.#resolveClosed?.(reason);
        this.#resolveClosed = undefined;
      }
    }
  }

  async #waitForDrainOrTimeout(flush: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.#closeTimeoutMs);
    });
    await Promise.race([flush, timeout]);
    if (timer !== undefined) clearTimeout(timer);
  }

  #assertOpen(): void {
    if (this.#state !== "open")
      throw new WorkspaceError("terminal_bridge_closed", "Terminal bridge is not open");
  }
}

function positiveInteger(value: number, name: string): number {
  return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, name);
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}
