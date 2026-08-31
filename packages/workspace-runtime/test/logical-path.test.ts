import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  parseLogicalWorkspacePath,
  resolveLogicalWorkspacePath,
  WorkspaceError,
} from "../src/index.js";

describe("logical workspace paths", () => {
  it.each(["", "relative", "/a/../b", "/a/./b", "/a//b", "/a\\b", "/a\0b"])(
    "rejects non-canonical input %j",
    (input) => expect(() => parseLogicalWorkspacePath(input)).toThrow(WorkspaceError),
  );

  it("maps canonical path segments below the root", () => {
    expect(
      resolveLogicalWorkspacePath("/tmp/root", parseLogicalWorkspacePath("/src/index.ts")),
    ).toBe("/tmp/root/src/index.ts");
  });

  it("round-trips safe generated segments without escaping", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/), { maxLength: 8 }),
        (segments) => {
          const logical = parseLogicalWorkspacePath(
            segments.length === 0 ? "/" : `/${segments.join("/")}`,
          );
          const host = resolveLogicalWorkspacePath("/tmp/cockpit-root", logical);
          expect(host === "/tmp/cockpit-root" || host.startsWith("/tmp/cockpit-root/")).toBe(true);
        },
      ),
      { seed: 0xc0c0a17 },
    );
  });

  it("preserves Unicode code points without normalization or host-path conversion", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .string({ minLength: 1, maxLength: 12 })
            .filter(
              (segment) =>
                segment !== "." &&
                segment !== ".." &&
                !segment.includes("/") &&
                !segment.includes("\\") &&
                !segment.includes("\0"),
            ),
          { minLength: 1, maxLength: 5 },
        ),
        (segments) => {
          const serialized = `/${segments.join("/")}`;
          expect(parseLogicalWorkspacePath(serialized)).toBe(serialized);
        },
      ),
      { seed: 0x51ced },
    );
  });
});
