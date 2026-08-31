import { describe, expect, it } from "vitest";
import { nextProjectId } from "../src/domain-adapter.js";
import { SessionLedger } from "../src/session-ledger.js";

describe("SessionLedger", () => {
  it("enforces claim ownership and delivers committed responses", async () => {
    const ledger = new SessionLedger();
    const session = ledger.createSession();
    const pending = ledger.createPending(session.id, { model: "gpt-test" });
    const controller = new AbortController();
    const completion = ledger.waitForCommit(pending.id, controller.signal);
    const playerId = nextProjectId("ply");
    const otherPlayerId = nextProjectId("ply");
    ledger.claim(session.id, pending.id, playerId);
    expect(() => ledger.commit(session.id, pending.id, otherPlayerId, { id: "response" })).toThrow(
      /Claim/,
    );
    ledger.commit(session.id, pending.id, playerId, { id: "response" });
    await expect(completion).resolves.toEqual({ id: "response" });
    expect(ledger.commit(session.id, pending.id, playerId, { id: "response" }).state).toBe(
      "committed",
    );
    expect(() =>
      ledger.commit(session.id, pending.id, playerId, { id: "different-response" }),
    ).toThrow(/different response/);
    expect(ledger.diagnostics().waiters).toBe(0);
  });

  it("removes a waiter immediately when the client aborts", async () => {
    const ledger = new SessionLedger();
    const session = ledger.createSession();
    const pending = ledger.createPending(session.id, {});
    const controller = new AbortController();
    const completion = ledger.waitForCommit(pending.id, controller.signal);
    controller.abort();
    await expect(completion).rejects.toMatchObject({ code: "client_disconnected" });
    expect(ledger.diagnostics().waiters).toBe(0);
  });

  it("rejects a duplicate waiter rather than orphaning the first", async () => {
    const ledger = new SessionLedger();
    const session = ledger.createSession();
    const pending = ledger.createPending(session.id, {});
    const controller = new AbortController();
    const first = ledger.waitForCommit(pending.id, controller.signal);
    await expect(ledger.waitForCommit(pending.id, controller.signal)).rejects.toMatchObject({
      code: "response_waiter_exists",
    });
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: "client_disconnected" });
  });
});
