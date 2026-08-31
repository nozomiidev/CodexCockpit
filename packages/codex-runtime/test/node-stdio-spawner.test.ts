import { describe, expect, it } from "vitest";
import {
  NodeStdioAppServerSpawner,
  type ProcessTerminationStrategy,
  type TerminableProcess,
} from "../src/node-stdio-spawner.js";

describe("NodeStdioAppServerSpawner lifecycle", () => {
  it("closes stdin without hanging when the child exits concurrently", async () => {
    const handle = await spawnNode(new NodeStdioAppServerSpawner(), "process.exit(0)");
    await handle.exited;
    await expect(handle.connection?.close()).resolves.toBeUndefined();
  });

  it("uses an injected process-tree strategy for non-POSIX supervisors", async () => {
    const strategy = new RecordingTerminationStrategy();
    const handle = await spawnNode(
      new NodeStdioAppServerSpawner(strategy),
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
    );
    await handle.stop(AbortSignal.abort());
    expect(strategy.calls).toEqual(["graceful", "force"]);
    await expect(handle.exited).resolves.toMatchObject({ exitCode: null });
  });
});

class RecordingTerminationStrategy implements ProcessTerminationStrategy {
  readonly calls: string[] = [];

  requestGraceful(_process: TerminableProcess): void {
    this.calls.push("graceful");
  }

  force(process: TerminableProcess): void {
    this.calls.push("force");
    process.kill("SIGKILL");
  }
}

async function spawnNode(spawner: NodeStdioAppServerSpawner, source: string) {
  return await spawner.spawn({
    executable: "node",
    args: ["-e", source],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "" },
    transport: { kind: "stdio" },
  });
}
