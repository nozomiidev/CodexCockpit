import { createProjectId, type ProjectId, type ProjectIdPrefix } from "@codex-cockpit/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DomainError,
  decideClaim,
  decideCommitResponse,
  decideRenewClaim,
  pendingInference,
  reduceInferenceEvents,
} from "../src/index.js";

const nowMs = 1_725_148_800_000;
const digest = `sha256:${"a".repeat(64)}`;

function id<Prefix extends ProjectIdPrefix>(prefix: Prefix, seed: number): ProjectId<Prefix> {
  return createProjectId(prefix, {
    nowMs: nowMs + seed,
    randomBytes: Uint8Array.from({ length: 10 }, (_, index) => (seed + index) % 256),
  });
}

describe("inference response claim", () => {
  it("claims, renews, and commits with optimistic revision checks", () => {
    const inferenceId = id("inf", 1);
    const claimId = id("clm", 2);
    const playerId = id("ply", 3);
    const initial = pendingInference(inferenceId);
    const claimedEvents = decideClaim(initial, {
      claimId,
      playerId,
      leaseDurationMs: 10_000,
      nowMs,
    });
    const claimed = reduceInferenceEvents(initial, claimedEvents);
    const renewedEvents = decideRenewClaim(claimed, {
      claimId,
      playerId,
      expectedRevision: 1,
      leaseDurationMs: 20_000,
      nowMs: nowMs + 1_000,
    });
    const renewed = reduceInferenceEvents(initial, [...claimedEvents, ...renewedEvents]);
    const committedEvents = decideCommitResponse(renewed, {
      claimId,
      playerId,
      expectedRevision: 2,
      responseId: id("rsp", 4),
      responseDigest: digest,
      commandId: id("cmd", 5),
      nowMs: nowMs + 2_000,
    });

    expect(
      reduceInferenceEvents(initial, [...claimedEvents, ...renewedEvents, ...committedEvents]),
    ).toMatchObject({ status: "committed", responseDigest: digest });
  });

  it("expires an old lease explicitly before assigning a replacement", () => {
    const inferenceId = id("inf", 10);
    const initial = pendingInference(inferenceId);
    const first = decideClaim(initial, {
      claimId: id("clm", 11),
      playerId: id("ply", 12),
      leaseDurationMs: 1_000,
      nowMs,
    });
    const claimed = reduceInferenceEvents(initial, first);
    const replacement = decideClaim(claimed, {
      claimId: id("clm", 13),
      playerId: id("ply", 14),
      leaseDurationMs: 1_000,
      nowMs: nowMs + 1_000,
    });

    expect(replacement.map((event) => event.type)).toEqual([
      "inference.request.expired",
      "inference.request.claimed",
    ]);
    expect(reduceInferenceEvents(claimed, replacement)).toMatchObject({
      status: "claimed",
      revision: 2,
    });
  });

  it("rejects stale revisions and expired lease commits with stable codes", () => {
    const inferenceId = id("inf", 20);
    const initial = pendingInference(inferenceId);
    const claimId = id("clm", 21);
    const playerId = id("ply", 22);
    const claimed = reduceInferenceEvents(
      initial,
      decideClaim(initial, { claimId, playerId, leaseDurationMs: 1_000, nowMs }),
    );
    const commit = (expectedRevision: number, atMs: number) =>
      decideCommitResponse(claimed, {
        claimId,
        playerId,
        expectedRevision,
        responseId: id("rsp", 23),
        responseDigest: digest,
        commandId: id("cmd", 24),
        nowMs: atMs,
      });

    expectDomainCode(() => commit(2, nowMs), "revision_conflict");
    expectDomainCode(() => commit(1, nowMs + 1_000), "claim_expired");
  });

  it("makes an identical committed command idempotent", () => {
    const inferenceId = id("inf", 30);
    const initial = pendingInference(inferenceId);
    const claimId = id("clm", 31);
    const playerId = id("ply", 32);
    const commandId = id("cmd", 33);
    const responseId = id("rsp", 34);
    const claimedEvents = decideClaim(initial, {
      claimId,
      playerId,
      leaseDurationMs: 5_000,
      nowMs,
    });
    const claimed = reduceInferenceEvents(initial, claimedEvents);
    const input = {
      claimId,
      playerId,
      expectedRevision: 1,
      responseId,
      responseDigest: digest,
      commandId,
      nowMs: nowMs + 1,
    } as const;
    const committed = reduceInferenceEvents(initial, [
      ...claimedEvents,
      ...decideCommitResponse(claimed, input),
    ]);

    expect(decideCommitResponse(committed, input)).toEqual([]);
  });

  it("accepts exact lease limits and rejects adjacent out-of-range values", () => {
    for (const leaseDurationMs of [1_000, 300_000]) {
      const initial = pendingInference(id("inf", leaseDurationMs));
      expect(
        decideClaim(initial, {
          claimId: id("clm", leaseDurationMs + 1),
          playerId: id("ply", leaseDurationMs + 2),
          leaseDurationMs,
          nowMs,
        }),
      ).toHaveLength(1);
    }
    for (const leaseDurationMs of [999, 300_001]) {
      const initial = pendingInference(id("inf", leaseDurationMs));
      expectDomainCode(
        () =>
          decideClaim(initial, {
            claimId: id("clm", leaseDurationMs + 1),
            playerId: id("ply", leaseDurationMs + 2),
            leaseDurationMs,
            nowMs,
          }),
        "invalid_lease_duration",
      );
    }
  });
});

it("sets expiry to exactly now plus any valid lease duration", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1_000, max: 300_000 }), (leaseDurationMs) => {
      const initial = pendingInference(id("inf", 40));
      const events = decideClaim(initial, {
        claimId: id("clm", 41),
        playerId: id("ply", 42),
        leaseDurationMs,
        nowMs,
      });
      expect(reduceInferenceEvents(initial, events)).toMatchObject({
        expiresAtMs: nowMs + leaseDurationMs,
      });
    }),
    { seed: 20260831 },
  );
});

it("replays every valid renewal history deterministically", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 1_000, max: 300_000 }), { maxLength: 30 }),
      (durations) => {
        const initial = pendingInference(id("inf", 50));
        const claimId = id("clm", 51);
        const playerId = id("ply", 52);
        const events = [
          ...decideClaim(initial, { claimId, playerId, leaseDurationMs: 1_000, nowMs }),
        ];
        let state = reduceInferenceEvents(initial, events);
        let currentMs = nowMs;
        for (const leaseDurationMs of durations) {
          if (state.status !== "claimed") {
            throw new Error("Generated history unexpectedly lost its claim");
          }
          const renewed = decideRenewClaim(state, {
            claimId,
            playerId,
            expectedRevision: state.revision,
            leaseDurationMs,
            nowMs: currentMs,
          });
          events.push(...renewed);
          state = reduceInferenceEvents(state, renewed);
          currentMs += Math.min(leaseDurationMs - 1, 100);
        }
        expect(reduceInferenceEvents(initial, events)).toEqual(
          reduceInferenceEvents(initial, events),
        );
      },
    ),
    { seed: 20260831 },
  );
});

it("deduplicates repeated commits for every valid response digest", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 }),
      (digits) => {
        const responseDigest = `sha256:${digits.map((digit) => digit.toString(16)).join("")}`;
        const initial = pendingInference(id("inf", 60));
        const claimId = id("clm", 61);
        const playerId = id("ply", 62);
        const claimedEvents = decideClaim(initial, {
          claimId,
          playerId,
          leaseDurationMs: 5_000,
          nowMs,
        });
        const claimed = reduceInferenceEvents(initial, claimedEvents);
        const input = {
          claimId,
          playerId,
          expectedRevision: 1,
          responseId: id("rsp", 63),
          responseDigest,
          commandId: id("cmd", 64),
          nowMs: nowMs + 1,
        } as const;
        const committed = reduceInferenceEvents(claimed, decideCommitResponse(claimed, input));
        expect(decideCommitResponse(committed, input)).toEqual([]);
      },
    ),
    { seed: 20260831 },
  );
});

function expectDomainCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Expected operation to fail");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DomainError);
    if (error instanceof DomainError) {
      expect(error.code).toBe(code);
    }
  }
}
