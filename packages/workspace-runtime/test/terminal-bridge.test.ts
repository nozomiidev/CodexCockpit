import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HostWorkspace,
  TerminalBridge,
  type TerminalBridgeCloseReason,
  type TerminalDiagnostic,
  type TerminalLifecycleState,
  type TerminalSession,
} from "../src/index.js";

class FakeTerminalSession implements TerminalSession {
  readonly sessionId = "pty_test";
  state: TerminalLifecycleState = "running";
  readonly writes: Uint8Array[] = [];
  readonly resizes: Array<readonly [number, number]> = [];
  cancelCount = 0;
  writeGate: Promise<void> | undefined;
  readonly #outputListeners = new Set<(bytes: Uint8Array) => void>();
  readonly #diagnosticListeners = new Set<(diagnostic: TerminalDiagnostic) => void>();

  get diagnosticListenerCount(): number {
    return this.#diagnosticListeners.size;
  }

  async write(bytes: Uint8Array): Promise<void> {
    this.writes.push(Uint8Array.from(bytes));
    await this.writeGate;
  }
  async resize(columns: number, rows: number): Promise<void> {
    this.resizes.push([columns, rows]);
  }
  async cancel(): Promise<void> {
    this.cancelCount += 1;
    this.state = "exited";
  }
  outputSnapshot(): Uint8Array {
    return new Uint8Array();
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
  emitOutput(bytes: Uint8Array): void {
    for (const listener of this.#outputListeners) listener(bytes);
  }
  emitState(state: TerminalLifecycleState): void {
    this.state = state;
    for (const listener of this.#diagnosticListeners) listener(this.#diagnostic());
  }
  #diagnostic(): TerminalDiagnostic {
    return {
      sessionId: this.sessionId,
      state: this.state,
      occurredAtMs: Date.now(),
      droppedOutputBytes: 0,
    };
  }
}

function controllablePromise(): { readonly promise: Promise<void>; resolve(): void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

describe("TerminalBridge", () => {
  it("preserves binary input/output and forwards dimensions", async () => {
    const session = new FakeTerminalSession();
    const output: Uint8Array[] = [];
    const bridge = new TerminalBridge({
      session,
      sink: {
        send: async (bytes) => {
          output.push(Uint8Array.from(bytes));
        },
        close: async () => undefined,
      },
    });
    bridge.start();
    const input = Uint8Array.from([0, 255, 1]);
    await bridge.input(input);
    input.fill(7);
    await bridge.resize(120, 40);
    session.emitOutput(Uint8Array.from([255, 0, 128]));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(session.writes[0]).toEqual(Uint8Array.from([0, 255, 1]));
    expect(session.resizes).toEqual([[120, 40]]);
    expect(output).toEqual([Uint8Array.from([255, 0, 128])]);
    await bridge.close();
  });

  it("closes and cancels once under concurrent close and process-exit races", async () => {
    const session = new FakeTerminalSession();
    const reasons: TerminalBridgeCloseReason[] = [];
    const bridge = new TerminalBridge({
      session,
      sink: {
        send: async () => undefined,
        close: async (reason) => {
          reasons.push(reason);
        },
      },
    });
    bridge.start();
    const closing = [bridge.close(), bridge.close()];
    session.emitState("exited");
    await Promise.all(closing);
    expect(session.cancelCount).toBe(1);
    expect(reasons).toEqual([{ code: "client_closed" }]);
    await expect(bridge.input(Uint8Array.of(1))).rejects.toMatchObject({
      code: "terminal_bridge_closed",
    });
  });

  it("bounds queued output while the transport is backpressured", async () => {
    const session = new FakeTerminalSession();
    const blocked = controllablePromise();
    const close = vi.fn(async () => undefined);
    const bridge = new TerminalBridge({
      session,
      maxQueuedBytes: 4,
      closeTimeoutMs: 10,
      sink: { send: async () => blocked.promise, close },
    });
    bridge.start();
    session.emitOutput(Uint8Array.from([1, 2, 3]));
    session.emitOutput(Uint8Array.from([4, 5]));
    const reason = await bridge.closed;
    expect(reason.code).toBe("backpressure_limit");
    expect(session.cancelCount).toBe(1);
    expect(close).toHaveBeenCalledOnce();
    blocked.resolve();
  });

  it("serializes and bounds aggregate terminal input backpressure", async () => {
    const session = new FakeTerminalSession();
    const blocked = controllablePromise();
    session.writeGate = blocked.promise;
    const bridge = new TerminalBridge({
      session,
      maxInputBytes: 3,
      maxQueuedInputBytes: 3,
      sink: { send: async () => undefined, close: async () => undefined },
    });
    bridge.start();
    const first = bridge.input(Uint8Array.from([1, 2]));
    await expect(bridge.input(Uint8Array.from([3, 4]))).rejects.toMatchObject({
      code: "resource_limit",
    });
    blocked.resolve();
    await first;
    expect(session.writes).toEqual([Uint8Array.from([1, 2])]);
    await bridge.close();
  });

  it("maps a real shell lifecycle and starts it at the authorized root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-bridge-"));
    await fs.writeFile(path.join(root, "workspace-marker"), "ok");
    const workspace = await HostWorkspace.open(root);
    const session = workspace.openTerminal({ shell: "/bin/sh" });
    const output: Uint8Array[] = [];
    const statuses: TerminalLifecycleState[] = [];
    const bridge = new TerminalBridge({
      session,
      sink: {
        send: async (bytes) => {
          output.push(Uint8Array.from(bytes));
        },
        close: async () => undefined,
      },
      onStatus: (diagnostic) => statuses.push(diagnostic.state),
    });
    bridge.start();
    await bridge.input(Buffer.from("test -f workspace-marker && printf ROOT_OK; exit\n"));
    expect((await bridge.closed).code).toBe("process_exited");
    expect(Buffer.concat(output).toString("utf8")).toContain("ROOT_OK");
    expect(statuses).toContain("running");
    expect(statuses).toContain("exited");
    await fs.rm(root, { recursive: true });
  });

  it("rejects invalid limits before acquiring process resources", () => {
    const session = new FakeTerminalSession();
    expect(
      () =>
        new TerminalBridge({
          session,
          sink: { send: async () => undefined, close: async () => undefined },
          maxQueuedBytes: 0,
        }),
    ).toThrow(RangeError);
    expect(session.cancelCount).toBe(0);
  });

  it("cleans a synchronous terminal-state subscription during start", async () => {
    const session = new FakeTerminalSession();
    session.state = "failed";
    const bridge = new TerminalBridge({
      session,
      sink: { send: async () => undefined, close: async () => undefined },
    });
    bridge.start();
    expect((await bridge.closed).code).toBe("process_failed");
    expect(session.diagnosticListenerCount).toBe(0);
  });
});
