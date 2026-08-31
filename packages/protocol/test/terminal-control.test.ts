import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isTerminalControlMessage, isTerminalStatusEvent } from "../src/index.js";

describe("terminal control contract", () => {
  it("accepts bounded resize, close, and lifecycle status", () => {
    expect(
      isTerminalControlMessage({ schemaVersion: 1, type: "terminal.resize", cols: 80, rows: 24 }),
    ).toBe(true);
    expect(isTerminalControlMessage({ schemaVersion: 1, type: "terminal.close" })).toBe(true);
    expect(
      isTerminalStatusEvent({
        schemaVersion: 1,
        type: "terminal.status",
        state: "exited",
        exitCode: 0,
        signal: null,
      }),
    ).toBe(true);
  });

  it("rejects invalid dimensions, text data in control JSON, and unknown status", () => {
    fc.assert(
      fc.property(
        fc.integer().filter((value) => value < 1 || value > 1_000),
        (cols) => {
          expect(
            isTerminalControlMessage({ schemaVersion: 1, type: "terminal.resize", cols, rows: 24 }),
          ).toBe(false);
        },
      ),
      { seed: 20260831 },
    );
    expect(
      isTerminalControlMessage({ schemaVersion: 1, type: "terminal.input", data: "ls\n" }),
    ).toBe(false);
    expect(
      isTerminalControlMessage({ schemaVersion: 1, type: "terminal.close", extra: true }),
    ).toBe(false);
    expect(
      isTerminalStatusEvent({ schemaVersion: 1, type: "terminal.status", state: "unknown" }),
    ).toBe(false);
  });

  it("fails closed for missing and unknown protocol versions", () => {
    expect(isTerminalControlMessage({ type: "terminal.close" })).toBe(false);
    expect(isTerminalStatusEvent({ type: "terminal.status", state: "running" })).toBe(false);
    fc.assert(
      fc.property(
        fc.integer().filter((version) => version !== 1),
        (schemaVersion) => {
          expect(isTerminalControlMessage({ schemaVersion, type: "terminal.close" })).toBe(false);
          expect(
            isTerminalStatusEvent({ schemaVersion, type: "terminal.status", state: "running" }),
          ).toBe(false);
        },
      ),
      { seed: 20260831 },
    );
  });
});
