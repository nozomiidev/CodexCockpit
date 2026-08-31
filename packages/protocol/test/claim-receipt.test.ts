import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createProjectId, isInferenceClaimReceipt } from "../src/index.js";

const nowMs = 1_725_148_800_000;
const id = <Prefix extends "ses" | "inf" | "clm" | "ply">(prefix: Prefix) =>
  createProjectId(prefix, { nowMs, randomBytes: new Uint8Array(10) });
const receipt = {
  schemaVersion: 1,
  sessionId: id("ses"),
  inferenceId: id("inf"),
  claimId: id("clm"),
  playerId: id("ply"),
  revision: 1,
  leaseExpiresAt: "2026-08-31T00:01:00.000Z",
};

describe("inference claim receipt", () => {
  it("carries the exact coordinates required for a guarded commit", () => {
    expect(isInferenceClaimReceipt(receipt)).toBe(true);
  });

  it("rejects missing, additional, malformed, and unknown-version fields", () => {
    expect(isInferenceClaimReceipt({ ...receipt, claimId: undefined })).toBe(false);
    expect(isInferenceClaimReceipt({ ...receipt, extra: true })).toBe(false);
    expect(isInferenceClaimReceipt({ ...receipt, leaseExpiresAt: "not-a-date" })).toBe(false);
    expect(isInferenceClaimReceipt({ ...receipt, leaseExpiresAt: "2026-02-30T00:00:00Z" })).toBe(
      false,
    );
    fc.assert(
      fc.property(
        fc.integer().filter((version) => version !== 1),
        (schemaVersion) => {
          expect(isInferenceClaimReceipt({ ...receipt, schemaVersion })).toBe(false);
        },
      ),
      { seed: 20260831 },
    );
  });
});
