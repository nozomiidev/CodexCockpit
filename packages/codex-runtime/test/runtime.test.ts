import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CommandExecBackend } from "../src/command-exec.js";
import { discoverCodex } from "../src/discovery.js";
import { initializeAppServer } from "../src/initialization.js";
import { JsonlDecoder } from "../src/jsonl-codec.js";
import { preflightRuntime } from "../src/preflight.js";
import { createSessionCodexHome } from "../src/session-home.js";
import type { JsonValue, ProcessProbe, RpcNotification, RpcPeer } from "../src/types.js";

describe("official Codex discovery", () => {
  it("accepts the official version output and preserves the selected executable", async () => {
    const probe: ProcessProbe = {
      run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "codex-cli 1.2.3\n", stderr: "" }),
    };
    await expect(
      discoverCodex(probe, { configuredExecutable: "/opt/codex/bin/codex" }),
    ).resolves.toEqual({
      executable: "/opt/codex/bin/codex",
      version: "1.2.3",
    });
  });

  it("stabilizes a configured relative executable before workspace cwd changes", async () => {
    const probe: ProcessProbe = {
      run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "codex-cli 0.151.0\n", stderr: "" }),
    };
    const installation = await discoverCodex(probe, { configuredExecutable: "./tools/codex" });
    expect(installation.executable).toBe(join(process.cwd(), "tools", "codex"));
  });

  it("reports absence as a diagnostic instead of requiring credentials", async () => {
    const probe: ProcessProbe = { run: vi.fn().mockRejectedValue(new Error("ENOENT")) };
    const report = await preflightRuntime(probe, { transport: { kind: "stdio" } });
    expect(report.ready).toBe(false);
    expect(report.checks[0]?.id).toBe("codex_executable");
  });
});

describe("session configuration", () => {
  it("writes an isolated non-overwriting CODEX_HOME without credentials", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "cockpit-runtime-"));
    const home = await createSessionCodexHome({
      rootDirectory,
      model: 'training"model',
      gatewayBaseUrl: "http://127.0.0.1:4319/v1",
    });
    const config = await readFile(home.configPath, "utf8");
    expect(config).toContain('model = "training\\"model"');
    expect(config).toContain('base_url = "http://127.0.0.1:4319/v1"');
    expect(config).not.toContain("api_key");
  });
});

describe("app-server wire contract", () => {
  it("decodes fixture messages split across arbitrary chunks", async () => {
    const fixture = await readFile(new URL("./fixtures/app-server.jsonl", import.meta.url), "utf8");
    const decoder = new JsonlDecoder();
    const splitAt = Math.floor(fixture.length / 2);
    const messages = [
      ...decoder.push(fixture.slice(0, splitAt)),
      ...decoder.push(fixture.slice(splitAt)),
    ];
    expect(messages).toHaveLength(2);
  });

  it("sends initialize then initialized in protocol order", async () => {
    const calls: string[] = [];
    const peer = createPeer({
      request: async (method) => {
        calls.push(method);
        return { userAgent: "fixture" };
      },
      notify: async (method) => {
        calls.push(method);
      },
    });
    await initializeAppServer(peer, { clientVersion: "0.0.0" });
    expect(calls).toEqual(["initialize", "initialized"]);
  });
});

describe("command/exec PTY lifecycle", () => {
  it("uses a caller-owned process id and byte-preserving base64 controls", async () => {
    let complete: ((value: JsonValue) => void) | undefined;
    const requests: Array<{ method: string; params: JsonValue }> = [];
    const peer = createPeer({
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "command/exec") {
          return await new Promise<JsonValue>((resolve) => {
            complete = resolve;
          });
        }
        return {};
      },
    });
    const backend = new CommandExecBackend(peer);
    const session = await backend.open({
      processId: "shell-1",
      command: ["bash", "-i"],
      cwd: "/workspace",
      rows: 40,
      cols: 120,
      permissionProfile: ":workspace",
    });
    await session.write(Uint8Array.from([0, 255]));
    await session.resize(48, 160);
    await session.terminate();
    complete?.({ exitCode: 137, stdout: "", stderr: "" });
    await expect(session.completed).resolves.toMatchObject({ exitCode: 137 });
    expect(requests.map(({ method }) => method)).toEqual([
      "command/exec",
      "command/exec/write",
      "command/exec/resize",
      "command/exec/terminate",
    ]);
    expect(requests[1]?.params).toEqual({ processId: "shell-1", deltaBase64: "AP8=" });
  });
});

function createPeer(overrides: Partial<RpcPeer>): RpcPeer {
  return {
    request: overrides.request ?? (async () => ({})),
    notify: overrides.notify ?? (async () => undefined),
    notifications: overrides.notifications ?? notifications,
  };
}

async function* notifications(_signal?: AbortSignal): AsyncIterable<RpcNotification> {
  const empty: RpcNotification[] = [];
  for (const notification of empty) yield notification;
}
