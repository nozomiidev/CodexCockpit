import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { CodexRuntimeError } from "./errors.js";
import { encodeAppServerMessage, JsonlDecoder } from "./jsonl-codec.js";
import type {
  AppServerConnection,
  AppServerMessage,
  AppServerSpawner,
  AppServerSpawnSpecification,
  ChildProcessHandle,
  ProcessResult,
} from "./types.js";

/** Concrete supervisor for the default stdio JSONL transport. */
export class NodeStdioAppServerSpawner implements AppServerSpawner {
  readonly #terminationStrategy: ProcessTerminationStrategy;

  constructor(
    terminationStrategy: ProcessTerminationStrategy = new NodeSignalTerminationStrategy(),
  ) {
    this.#terminationStrategy = terminationStrategy;
  }

  async spawn(specification: AppServerSpawnSpecification): Promise<ChildProcessHandle> {
    if (specification.transport.kind !== "stdio") {
      throw new CodexRuntimeError(
        "unsupported_capability",
        "NodeStdioAppServerSpawner only owns stdio; inject a Unix-WebSocket spawner for Unix transport.",
      );
    }
    const child = spawn(specification.executable, [...specification.args], {
      cwd: specification.cwd,
      env: { ...specification.env },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const connection = new StdioAppServerConnection(child);
    const exited = observeExit(child);
    let stopping: Promise<void> | undefined;
    return {
      connection,
      exited,
      stop: async (signal) => {
        stopping ??= terminateChild(child, exited, this.#terminationStrategy, signal);
        await stopping;
      },
    };
  }
}

class StdioAppServerConnection implements AppServerConnection {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #queue = new AsyncMessageQueue();
  readonly #decoder = new JsonlDecoder();

  constructor(child: ChildProcessWithoutNullStreams) {
    this.#child = child;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      try {
        for (const message of this.#decoder.push(chunk)) {
          if (!this.#queue.push(message)) this.#child.kill("SIGTERM");
        }
      } catch (error: unknown) {
        this.#queue.fail(error);
      }
    });
    child.stdout.once("end", () => {
      try {
        for (const message of this.#decoder.finish()) this.#queue.push(message);
        this.#queue.end();
      } catch (error: unknown) {
        this.#queue.fail(error);
      }
    });
    child.once("error", (error) => this.#queue.fail(error));
  }

  async send(message: AppServerMessage): Promise<void> {
    if (!this.#child.stdin.write(encodeAppServerMessage(message), "utf8")) {
      await waitForDrain(this.#child);
    }
  }

  messages(signal?: AbortSignal): AsyncIterable<AppServerMessage> {
    return this.#queue.iterate(signal);
  }

  async close(): Promise<void> {
    if (!this.#child.stdin.destroyed) {
      await closeStdin(this.#child, 5_000);
    }
  }
}

export interface TerminableProcess {
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/**
 * Platform process-tree termination port. Windows hosts should inject a tested
 * strategy backed by taskkill, Job Objects, or their runtime supervisor.
 */
export interface ProcessTerminationStrategy {
  requestGraceful(process: TerminableProcess): void;
  force(process: TerminableProcess): void;
}

export class NodeSignalTerminationStrategy implements ProcessTerminationStrategy {
  requestGraceful(process: TerminableProcess): void {
    process.kill("SIGTERM");
  }

  force(process: TerminableProcess): void {
    process.kill("SIGKILL");
  }
}

async function closeStdin(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdin.removeListener("finish", onFinish);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
    };
    const succeed = () => {
      cleanup();
      resolve();
    };
    const onFinish = () => succeed();
    const onClose = () => succeed();
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new CodexRuntimeError("request_timeout", "Closing app-server stdin timed out."));
    }, timeoutMs);
    child.stdin.once("finish", onFinish);
    child.once("error", onError);
    child.once("close", onClose);
    child.stdin.end();
  });
}

async function waitForDrain(child: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      child.stdin.removeListener("drain", onDrain);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new CodexRuntimeError("app_server_exited", "app-server closed while writing."));
    };
    child.stdin.once("drain", onDrain);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

class AsyncMessageQueue {
  readonly #values: AppServerMessage[] = [];
  #waiter: (() => void) | undefined;
  #ended = false;
  #error: unknown;

  push(message: AppServerMessage): boolean {
    if (this.#values.length >= 4_096) {
      this.fail(
        new CodexRuntimeError("app_server_exited", "app-server notification queue overflowed.", {
          capacity: 4_096,
        }),
      );
      return false;
    }
    this.#values.push(message);
    this.#wake();
    return true;
  }

  end(): void {
    this.#ended = true;
    this.#wake();
  }

  fail(error: unknown): void {
    this.#error = error;
    this.#wake();
  }

  async *iterate(signal?: AbortSignal): AsyncIterable<AppServerMessage> {
    while (true) {
      if (signal?.aborted === true) return;
      const value = this.#values.shift();
      if (value !== undefined) {
        yield value;
        continue;
      }
      if (this.#error !== undefined) throw this.#error;
      if (this.#ended) return;
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal?.removeEventListener("abort", wake);
          resolve();
        };
        this.#waiter = wake;
        signal?.addEventListener("abort", wake, { once: true });
      });
    }
  }

  #wake(): void {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}

function observeExit(child: ChildProcessWithoutNullStreams): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-64 * 1024);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout: "", stderr }));
  });
}

async function terminateChild(
  child: ChildProcessWithoutNullStreams,
  exited: Promise<ProcessResult>,
  strategy: ProcessTerminationStrategy,
  signal?: AbortSignal,
): Promise<void> {
  if (child.exitCode !== null) return;
  strategy.requestGraceful(child);
  const graceful = await settlesBefore(exited, 2_000, signal);
  if (!graceful && child.exitCode === null) strategy.force(child);
  await exited;
}

async function settlesBefore(
  exited: Promise<ProcessResult>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const finish = (result: boolean) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => finish(false);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) finish(false);
    exited.then(() => finish(true), reject);
  });
}
