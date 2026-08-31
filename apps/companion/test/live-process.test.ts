import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { nextProjectId } from "../src/domain-adapter.js";

const children = new Set<ChildProcessWithoutNullStreams>();
afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => undefined);
    }
  }
  children.clear();
});

describe("live companion process", () => {
  it("serves a real HTTP/SSE turn and shuts down without an orphan", async () => {
    const port = await availablePort();
    const token = "live-smoke-token-0123456789";
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        CODEX_COCKPIT_HOST: "127.0.0.1",
        CODEX_COCKPIT_PORT: String(port),
        CODEX_COCKPIT_TOKEN: token,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    await waitUntil(
      () => output.includes("companion ready"),
      5_000,
      () => output,
    );
    expect(output).toContain('"phase":"configuration"');
    expect(output).toContain('"phase":"listen"');

    const baseUrl = `http://127.0.0.1:${port}`;
    const authorization = `Bearer ${token}`;
    const readiness = await fetch(`${baseUrl}/readyz`);
    expect(await readiness.json()).toMatchObject({ status: "ready", waiters: 0 });
    const sessionResponse = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { authorization },
    });
    const session = await jsonRecord(sessionResponse);
    const sessionId = requiredString(session, "id");
    const stream = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        "x-codex-cockpit-session-id": sessionId,
      },
      body: JSON.stringify({ model: "gpt-5.5", input: [], stream: true }),
    });
    expect(stream.status).toBe(200);

    let inferenceId: string | undefined;
    await waitUntil(async () => {
      const pendingResponse = await fetch(`${baseUrl}/sessions/${sessionId}/pending`, {
        headers: { authorization },
      });
      const pending = await jsonRecord(pendingResponse);
      const items = pending["items"];
      if (Array.isArray(items) && isRecord(items[0])) inferenceId = optionalString(items[0], "id");
      return inferenceId !== undefined;
    }, 3_000);
    if (inferenceId === undefined) throw new Error("live response was not queued");
    const playerId = nextProjectId("ply");
    const claimResponse = await checkedFetch(
      `${baseUrl}/sessions/${sessionId}/pending/${inferenceId}/claim`,
      {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ playerId }),
      },
    );
    const claimReceipt = await jsonRecord(claimResponse);
    await checkedFetch(`${baseUrl}/sessions/${sessionId}/pending/${inferenceId}/commit`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        claimId: requiredString(claimReceipt, "claimId"),
        expectedRevision: claimReceipt["revision"],
        response: {
          output: [
            {
              id: "msg_live",
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "live smoke complete" }],
            },
          ],
        },
      }),
    });
    const frames = await stream.text();
    const eventTypes = frames
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => parseJson(line.slice(6)))
      .map((event) => (isRecord(event) ? optionalString(event, "type") : undefined));
    expect(eventTypes).toEqual([
      "response.created",
      "response.output_text.delta",
      "response.output_item.done",
      "response.completed",
    ]);

    const exit = once(child, "exit");
    child.kill("SIGTERM");
    const [exitCode, signal] = await Promise.race([
      exit,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error(`shutdown timed out:\n${output}`)), 7_000),
      ),
    ]);
    expect({ exitCode, signal }).toEqual({ exitCode: 0, signal: null });
    expect(output).toContain('"result":"graceful"');
    children.delete(child);
  }, 20_000);
});

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("port reservation failed");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function checkedFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response;
}

async function jsonRecord(response: Response): Promise<Readonly<Record<string, unknown>>> {
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error("response body is not a JSON object");
  return value;
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  diagnostics: () => string = () => "",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(`condition timed out\n${diagnostics()}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = optionalString(record, key);
  if (value === undefined) throw new Error(`${key} must be a string`);
  return value;
}

function optionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}
