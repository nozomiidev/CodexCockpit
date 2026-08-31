import { afterEach, describe, expect, it } from "vitest";
import { createCompanion } from "../src/app.js";
import { nextProjectId } from "../src/domain-adapter.js";

const token = "test-token-with-16-characters";
const apps: ReturnType<typeof createCompanion>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

function app() {
  const instance = createCompanion({
    token,
    allowedOrigins: ["https://cockpit.test"],
    logger: false,
  });
  apps.push(instance);
  return instance;
}

describe("companion HTTP boundary", () => {
  it("exposes health and observable readiness", async () => {
    const instance = app();
    const health = await instance.inject({ method: "GET", url: "/healthz" });
    expect(health.json()).toEqual({ status: "ok" });
    const readiness = await instance.inject({ method: "GET", url: "/readyz" });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({ status: "ready", sessions: 0, waiters: 0 });
  });

  it("returns RFC 9457 problems for invalid authentication and origin", async () => {
    const instance = app();
    const missing = await instance.inject({ method: "POST", url: "/sessions" });
    expect(missing.headers["content-type"]).toContain("application/problem+json");
    expect(missing.json()).toMatchObject({ status: 401, code: "invalid_token" });
    const forbidden = await instance.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}`, origin: "https://evil.test" },
    });
    expect(forbidden.json()).toMatchObject({ status: 403, code: "origin_not_allowed" });
  });

  it("answers browser preflight only for the configured static origin", async () => {
    const instance = app();
    const allowed = await instance.inject({
      method: "OPTIONS",
      url: "/sessions",
      headers: { origin: "https://cockpit.test" },
    });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://cockpit.test");
    expect(allowed.headers["access-control-allow-headers"]).toContain("authorization");
    const denied = await instance.inject({
      method: "OPTIONS",
      url: "/sessions",
      headers: { origin: "https://evil.test" },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("creates and lists sessions without exposing command execution", async () => {
    const instance = app();
    const created = await instance.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json<{ id: string }>();
    expect(session.id).toMatch(/^ses_[0-9a-f-]+$/);
    const loaded = await instance.inject({
      method: "GET",
      url: `/sessions/${session.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(loaded.json()).toMatchObject({ id: session.id });
    const arbitrary = await instance.inject({
      method: "POST",
      url: "/rpc",
      headers: { authorization: `Bearer ${token}` },
      payload: { argv: ["sh"] },
    });
    expect(arbitrary.statusCode).toBe(404);
  });

  it("bridges a Codex Responses request through claim and commit", async () => {
    const instance = app();
    const authorization = `Bearer ${token}`;
    const created = await instance.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization },
    });
    const { id: sessionId } = created.json<{ id: string }>();
    const rawRequest = '{\n  "model": "gpt-test", "input": "hello", "stream": true\n}';
    const streamed = instance.inject({
      method: "POST",
      url: "/v1/responses",
      headers: {
        authorization,
        "content-type": "application/json",
        "x-codex-cockpit-session-id": sessionId,
      },
      payload: rawRequest,
    });

    let requestId: string | undefined;
    for (let attempt = 0; attempt < 20 && requestId === undefined; attempt += 1) {
      const pending = await instance.inject({
        method: "GET",
        url: `/sessions/${sessionId}/pending`,
        headers: { authorization },
      });
      const item = pending.json<{ items: { id: string; rawRequestText?: string }[] }>().items[0];
      requestId = item?.id;
      if (item !== undefined) expect(item.rawRequestText).toBe(rawRequest);
      if (requestId === undefined) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(requestId).toMatch(/^inf_/);
    if (requestId === undefined) throw new Error("pending response was not observable");
    const playerId = nextProjectId("ply");
    const claim = await instance.inject({
      method: "POST",
      url: `/sessions/${sessionId}/pending/${requestId}/claim`,
      headers: { authorization },
      payload: { playerId },
    });
    const claimReceipt = claim.json<{ claimId: string; revision: number }>();
    const committed = await instance.inject({
      method: "POST",
      url: `/sessions/${sessionId}/pending/${requestId}/commit`,
      headers: { authorization },
      payload: {
        playerId,
        claimId: claimReceipt.claimId,
        expectedRevision: claimReceipt.revision,
        response: {
          output: [
            {
              id: "msg_demo",
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "done" }],
            },
          ],
        },
      },
    });
    expect(committed.statusCode).toBe(200);
    const completed = await streamed;
    expect(completed.payload).toContain('"type":"response.created"');
    expect(completed.payload).toContain('"type":"response.completed"');
  });
});
