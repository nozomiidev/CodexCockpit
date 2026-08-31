import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { BoundedByteRing } from "./byte-ring.js";
import { WorkspaceError } from "./errors.js";

export type TerminalLifecycleState = "starting" | "running" | "stopping" | "exited" | "failed";
export interface TerminalDiagnostic {
  readonly sessionId: string;
  readonly state: TerminalLifecycleState;
  readonly occurredAtMs: number;
  readonly pid?: number;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly message?: string;
  readonly droppedOutputBytes: number;
}
export interface TerminalSessionOptions {
  readonly cwd: string;
  readonly shell?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly outputCapacityBytes?: number;
}
export interface TerminalSession {
  readonly sessionId: string;
  readonly state: TerminalLifecycleState;
  write(bytes: Uint8Array): Promise<void>;
  resize(columns: number, rows: number): Promise<void>;
  cancel(options?: { readonly graceMs?: number }): Promise<void>;
  outputSnapshot(): Uint8Array;
  onOutput(listener: (bytes: Uint8Array) => void): () => void;
  onDiagnostic(listener: (diagnostic: TerminalDiagnostic) => void): () => void;
}

/**
 * Pipe-based portable fallback. It runs bash/node/npm basics but deliberately does not
 * pretend to be a PTY; interactive full-screen programs belong in a node-pty adapter.
 */
export class PortableTerminalSession implements TerminalSession {
  readonly sessionId = `pty_${randomUUID()}`;
  readonly #ring: BoundedByteRing;
  readonly #outputListeners = new Set<(bytes: Uint8Array) => void>();
  readonly #diagnosticListeners = new Set<(diagnostic: TerminalDiagnostic) => void>();
  #child: ChildProcessWithoutNullStreams;
  #state: TerminalLifecycleState = "starting";

  constructor(options: TerminalSessionOptions) {
    this.#ring = new BoundedByteRing(options.outputCapacityBytes ?? 1024 * 1024);
    const shell = options.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
    this.#child = spawn(shell, [], {
      cwd: options.cwd,
      env: options.environment === undefined ? process.env : { ...options.environment },
      stdio: "pipe",
    });
    this.#child.stdout.on("data", (data: Buffer) => this.#emitOutput(data));
    this.#child.stderr.on("data", (data: Buffer) => this.#emitOutput(data));
    this.#child.once("spawn", () => {
      this.#state = "running";
      const pid = this.#child.pid;
      this.#emitDiagnostic(pid === undefined ? {} : { pid });
    });
    this.#child.once("error", (error) => {
      this.#state = "failed";
      this.#emitDiagnostic({ message: error.message });
    });
    this.#child.once("exit", (exitCode, signal) => {
      this.#state = "exited";
      this.#emitDiagnostic({ exitCode, signal });
    });
    this.#emitDiagnostic();
  }

  get state(): TerminalLifecycleState {
    return this.#state;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.#state !== "running" && this.#state !== "starting") {
      throw new WorkspaceError("terminal_not_running", "Terminal is not accepting input");
    }
    await new Promise<void>((resolve, reject) => {
      this.#child.stdin.write(bytes, (error) => (error ? reject(error) : resolve()));
    });
  }

  async resize(columns: number, rows: number): Promise<void> {
    if (!Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1) {
      throw new RangeError("Terminal dimensions must be positive integers");
    }
    this.#emitDiagnostic({ message: "resize_unsupported_by_pipe_backend" });
  }

  async cancel(options: { readonly graceMs?: number } = {}): Promise<void> {
    if (this.#state === "exited" || this.#state === "failed") return;
    const graceMs = options.graceMs ?? 1_000;
    if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 30_000) {
      throw new RangeError(
        "Cancellation grace must be an integer from 0 through 30000 milliseconds",
      );
    }
    this.#state = "stopping";
    this.#emitDiagnostic();
    const exited = new Promise<void>((resolve) => {
      this.#child.once("exit", () => resolve());
      this.#child.once("error", () => resolve());
    });
    this.#child.stdin.end();
    this.#child.kill("SIGTERM");
    let timer: NodeJS.Timeout | undefined;
    const graceElapsed = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, graceMs);
    });
    await Promise.race([exited, graceElapsed]);
    if (timer !== undefined) clearTimeout(timer);
    if (this.#isActive()) {
      this.#child.kill("SIGKILL");
      await exited;
    }
  }

  outputSnapshot(): Uint8Array {
    return this.#ring.snapshot();
  }
  onOutput(listener: (bytes: Uint8Array) => void): () => void {
    this.#outputListeners.add(listener);
    return () => this.#outputListeners.delete(listener);
  }
  onDiagnostic(listener: (diagnostic: TerminalDiagnostic) => void): () => void {
    this.#diagnosticListeners.add(listener);
    listener(this.#diagnostic());
    return () => this.#diagnosticListeners.delete(listener);
  }

  #emitOutput(bytes: Uint8Array): void {
    const copy = Uint8Array.from(bytes);
    this.#ring.push(copy);
    for (const listener of this.#outputListeners) listener(copy);
  }
  #isActive(): boolean {
    return this.#state !== "exited" && this.#state !== "failed";
  }
  #diagnostic(extra: Partial<TerminalDiagnostic> = {}): TerminalDiagnostic {
    return {
      sessionId: this.sessionId,
      state: this.#state,
      occurredAtMs: Date.now(),
      droppedOutputBytes: this.#ring.droppedByteCount,
      ...extra,
    };
  }
  #emitDiagnostic(extra: Partial<TerminalDiagnostic> = {}): void {
    const diagnostic = this.#diagnostic(extra);
    for (const listener of this.#diagnosticListeners) listener(diagnostic);
  }
}
