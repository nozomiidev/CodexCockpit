import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createProjectId, isProjectId, parseProjectId } from "../src/index.js";

describe("project IDs", () => {
  it("creates an RFC 9562 UUIDv7 with the requested prefix", () => {
    const id = createProjectId("ses", {
      nowMs: 1_725_148_800_000,
      randomBytes: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    });

    expect(id).toBe("ses_0191aae1-a400-7001-8203-040506070809");
    expect(isProjectId(id, "ses")).toBe(true);
    expect(isProjectId(id, "evt")).toBe(false);
  });

  it("rejects non-v7, uppercase, and mismatched identifiers", () => {
    expect(() => parseProjectId("ses_0191aeb0-d800-4001-8203-040506070809", "ses")).toThrow(
      TypeError,
    );
    expect(() => parseProjectId("evt_0191AEB0-D800-7001-8203-040506070809", "evt")).toThrow(
      TypeError,
    );
    expect(() => parseProjectId("evt_0191aeb0-d800-7001-8203-040506070809", "ses")).toThrow(
      TypeError,
    );
  });

  it("validates the caller-owned entropy contract", () => {
    expect(() => createProjectId("cmd", { nowMs: -1, randomBytes: new Uint8Array(10) })).toThrow(
      RangeError,
    );
    expect(() => createProjectId("cmd", { nowMs: 1, randomBytes: new Uint8Array(9) })).toThrow(
      RangeError,
    );
  });

  it("rejects arbitrary malformed prefixes and UUID text", () => {
    fc.assert(
      fc.property(fc.string(), (candidate) => {
        if (!candidate.startsWith("ses_") || candidate.length !== 40) {
          expect(isProjectId(candidate, "ses")).toBe(false);
        }
      }),
      { seed: 20260831 },
    );
    expect(isProjectId("unknown_0191aae1-a400-7001-8203-040506070809", "ses")).toBe(false);
  });
});
