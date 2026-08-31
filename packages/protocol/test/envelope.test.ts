import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createProjectId, isCommandEnvelope, isEventEnvelope } from "../src/index.js";

const nowMs = 1_725_148_800_000;
const bytes = new Uint8Array(10);
const id = <Prefix extends "cmd" | "evt" | "ses" | "req" | "ply">(prefix: Prefix) =>
  createProjectId(prefix, { nowMs, randomBytes: bytes });

const command = {
  schemaVersion: 1,
  commandId: id("cmd"),
  sessionId: id("ses"),
  correlationId: id("req"),
  actor: { role: "model-player", playerId: id("ply") },
  type: "inference.request.claim",
  sentAt: "2026-08-31T00:00:00.000Z",
  payload: {},
};

describe("runtime envelope validation", () => {
  it("accepts schema-equivalent command and event envelopes", () => {
    expect(isCommandEnvelope(command)).toBe(true);
    expect(
      isEventEnvelope({
        schemaVersion: 1,
        eventId: id("evt"),
        sessionId: id("ses"),
        seq: 1,
        causationId: id("cmd"),
        correlationId: id("req"),
        actor: { role: "system" },
        type: "inference.request.claimed",
        occurredAt: "2026-08-31T00:00:00+00:00",
        payload: {},
      }),
    ).toBe(true);
  });

  it("fails closed for unknown versions and additional properties", () => {
    fc.assert(
      fc.property(
        fc.integer().filter((version) => version !== 1),
        (schemaVersion) => {
          expect(isCommandEnvelope({ ...command, schemaVersion })).toBe(false);
        },
      ),
      { seed: 20260831 },
    );
    expect(isCommandEnvelope({ ...command, unexpected: true })).toBe(false);
    expect(isCommandEnvelope({ ...command, actor: { ...command.actor, unexpected: true } })).toBe(
      false,
    );
    expect(isCommandEnvelope({ ...command, sentAt: "2026-02-30T00:00:00.000Z" })).toBe(false);
  });
});
