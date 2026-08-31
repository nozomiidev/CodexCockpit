import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CodexSessionRuntimeFactory, type RpcPeerFactory } from "../src/session-runtime.js";
import type {
  AppServerConnection,
  AppServerMessage,
  AppServerSpawner,
  AppServerSpawnSpecification,
  ChildProcessHandle,
  JsonValue,
  ProcessProbe,
  RpcNotification,
  RpcPeer,
} from "../src/types.js";

describe("CodexSessionRuntimeFactory", () => {
  it("creates an initialized real-Codex session and launches Codex in the workspace PTY", async () => {
    const root = await mkdtemp(join(tmpdir(), "cockpit-session-runtime-"));
    const workspacePath = join(root, "workspace");
    const requests: Array<{ method: string; params: JsonValue }> = [];
    const notifications: string[] = [];
    const peer = fakePeer(requests, notifications);
    const spawner = new RecordingSpawner();
    const factory = new CodexSessionRuntimeFactory(successfulProbe(), spawner, peerFactory(peer));

    const result = await factory.create({
      sessionId: "ses_test",
      sessionRoot: root,
      workspacePath,
      gatewayBaseUrl: "http://127.0.0.1:4319/v1",
      gatewayBearerEnvKey: "CODEX_COCKPIT_GATEWAY_TOKEN",
      model: "gpt-5.5",
      clientVersion: "0.0.0",
      executable: "/opt/codex/bin/codex",
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(requests[0]?.method).toBe("initialize");
    expect(notifications).toEqual(["initialized"]);
    const config = await readFile(join(result.runtime.codexHome, "config.toml"), "utf8");
    expect(config).toContain('env_key = "CODEX_COCKPIT_GATEWAY_TOKEN"');
    expect(config).toContain('"x-codex-cockpit-session-id" = "ses_test"');

    await result.runtime.openCodexTerminal({ processId: "codex-1", rows: 40, cols: 120 });
    expect(requests[1]).toMatchObject({
      method: "command/exec",
      params: { command: ["/opt/codex/bin/codex"], cwd: workspacePath, tty: true },
    });
    await result.runtime.close();
    expect(spawner.stopped).toBe(true);
  });

  it("returns an explicit non-Codex demo fallback when Codex is absent", async () => {
    const probe: ProcessProbe = { run: vi.fn().mockRejectedValue(new Error("ENOENT")) };
    const spawner = new RecordingSpawner();
    const factory = new CodexSessionRuntimeFactory(probe, spawner, peerFactory(fakePeer([], [])));
    const result = await factory.create({
      sessionId: "ses_missing",
      sessionRoot: "/unused",
      workspacePath: "/workspace",
      gatewayBaseUrl: "http://127.0.0.1:4319/v1",
      model: "gpt-5.5",
      clientVersion: "0.0.0",
    });
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason.code).toBe("codex_not_found");
    expect(result.reason.demoFallback).toEqual(
      expect.objectContaining({ available: true, usesOfficialCodex: false }),
    );
    expect(spawner.specification).toBeUndefined();
  });

  it("refuses an installed Codex version that differs from the runtime pin", async () => {
    const probe: ProcessProbe = {
      run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "codex-cli 0.150.0\n", stderr: "" }),
    };
    const spawner = new RecordingSpawner();
    const factory = new CodexSessionRuntimeFactory(probe, spawner, peerFactory(fakePeer([], [])));
    const result = await factory.create({
      sessionId: "ses_wrong_version",
      sessionRoot: "/unused",
      workspacePath: "/workspace",
      gatewayBaseUrl: "http://127.0.0.1:4319/v1",
      model: "gpt-5.5",
      clientVersion: "0.0.0",
    });
    expect(result.status).toBe("unavailable");
    expect(result.preflight.checks).toContainEqual(
      expect.objectContaining({ id: "codex_version", status: "fail" }),
    );
    expect(spawner.specification).toBeUndefined();
  });

  it("cleans up a started process when initialization fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "cockpit-session-failure-"));
    const peer = fakePeer([], []);
    peer.request = vi.fn().mockRejectedValue(new Error("handshake rejected"));
    const spawner = new RecordingSpawner();
    const factory = new CodexSessionRuntimeFactory(successfulProbe(), spawner, peerFactory(peer));
    const result = await factory.create({
      sessionId: "ses_failed",
      sessionRoot: root,
      workspacePath: root,
      gatewayBaseUrl: "http://127.0.0.1:4319/v1",
      model: "gpt-5.5",
      clientVersion: "0.0.0",
    });
    expect(result.status).toBe("unavailable");
    expect(spawner.stopped).toBe(true);
    expect(spawner.connection.closed).toBe(true);
  });
});

class RecordingSpawner implements AppServerSpawner {
  specification: AppServerSpawnSpecification | undefined;
  stopped = false;
  readonly connection = new FakeConnection();

  async spawn(specification: AppServerSpawnSpecification): Promise<ChildProcessHandle> {
    this.specification = specification;
    return {
      connection: this.connection,
      exited: new Promise(() => undefined),
      stop: async () => {
        this.stopped = true;
      },
    };
  }
}

class FakeConnection implements AppServerConnection {
  closed = false;
  async send(_message: AppServerMessage): Promise<void> {}
  async *messages(_signal?: AbortSignal): AsyncIterable<AppServerMessage> {}
  async close(): Promise<void> {
    this.closed = true;
  }
}

function successfulProbe(): ProcessProbe {
  return {
    run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "codex-cli 0.151.0\n", stderr: "" }),
  };
}

function peerFactory(peer: RpcPeer): RpcPeerFactory {
  return { connect: async () => peer };
}

function fakePeer(
  requests: Array<{ method: string; params: JsonValue }>,
  sentNotifications: string[],
): RpcPeer {
  return {
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === "command/exec") return { exitCode: 0, stdout: "", stderr: "" };
      return { userAgent: "fixture" };
    },
    notify: async (method) => {
      sentNotifications.push(method);
    },
    notifications: emptyNotifications,
  };
}

async function* emptyNotifications(_signal?: AbortSignal): AsyncIterable<RpcNotification> {
  const values: RpcNotification[] = [];
  for (const value of values) yield value;
}
