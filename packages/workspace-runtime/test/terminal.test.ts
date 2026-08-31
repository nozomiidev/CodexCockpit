import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { PortableTerminalSession } from "../src/index.js";

describe("PortableTerminalSession", () => {
  it("streams binary-safe output, reports lifecycle, and exits", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-terminal-"));
    const session = new PortableTerminalSession({ cwd, outputCapacityBytes: 64 });
    const states: string[] = [];
    const diagnosticsDone = new Promise<void>((resolve) => {
      session.onDiagnostic((diagnostic) => {
        states.push(diagnostic.state);
        if (diagnostic.state === "exited") resolve();
      });
    });
    await session.write(Buffer.from("printf '\\001\\377Z'; exit\n"));
    await diagnosticsDone;
    expect([...session.outputSnapshot()]).toEqual([1, 255, 90]);
    expect(states).toContain("running");
    expect(states.at(-1)).toBe("exited");
    await fs.rm(cwd, { recursive: true });
  });

  it("validates resize and makes cancellation idempotent", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-terminal-"));
    const session = new PortableTerminalSession({ cwd });
    await expect(session.resize(0, 24)).rejects.toBeInstanceOf(RangeError);
    await session.resize(80, 24);
    await session.cancel({ graceMs: 100 });
    await session.cancel();
    await fs.rm(cwd, { recursive: true });
  });

  it("reports spawn failure and allows cancellation without hanging", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-terminal-"));
    const session = new PortableTerminalSession({
      cwd,
      shell: path.join(cwd, "definitely-does-not-exist"),
    });
    const failed = new Promise<void>((resolve) => {
      session.onDiagnostic((diagnostic) => {
        if (diagnostic.state === "failed") resolve();
      });
    });
    await failed;
    expect(session.state).toBe("failed");
    await session.cancel({ graceMs: 30_000 });
    await fs.rm(cwd, { recursive: true });
  });

  it("coalesces concurrent cancellation races and clears long grace timers", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-terminal-"));
    const baselineTimeouts = process
      .getActiveResourcesInfo()
      .filter((name) => name === "Timeout").length;
    const session = new PortableTerminalSession({ cwd });
    await Promise.all([
      session.cancel({ graceMs: 30_000 }),
      session.cancel({ graceMs: 30_000 }),
      session.cancel({ graceMs: 30_000 }),
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(session.state).toBe("exited");
    expect(
      process.getActiveResourcesInfo().filter((name) => name === "Timeout").length,
    ).toBeLessThanOrEqual(baselineTimeouts);
    await fs.rm(cwd, { recursive: true });
  });

  it("rejects unbounded cancellation waits", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-terminal-"));
    const session = new PortableTerminalSession({ cwd });
    await expect(session.cancel({ graceMs: Number.POSITIVE_INFINITY })).rejects.toBeInstanceOf(
      RangeError,
    );
    await session.cancel({ graceMs: 100 });
    await fs.rm(cwd, { recursive: true });
  });

  it("treats an explicit environment as an allow-list instead of inheriting secrets", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-terminal-"));
    const secretName = "CODEX_COCKPIT_TERMINAL_INHERITANCE_TEST";
    process.env[secretName] = "must-not-leak";
    const session = new PortableTerminalSession({
      cwd,
      environment: { PATH: process.env["PATH"] ?? "" },
    });
    delete process.env[secretName];
    const exited = new Promise<void>((resolve) => {
      session.onDiagnostic((diagnostic) => {
        if (diagnostic.state === "exited") resolve();
      });
    });
    await session.write(Buffer.from(`test -z "$${secretName}" && printf CLEAN; exit\n`));
    await exited;
    expect(Buffer.from(session.outputSnapshot()).toString("utf8")).toContain("CLEAN");
    await fs.rm(cwd, { recursive: true });
  });
});
