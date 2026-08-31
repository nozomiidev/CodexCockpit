import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createPayloadViews } from "../src/index.js";

describe("display payload redaction", () => {
  it("preserves authoritative raw identity and text while detaching the display projection", () => {
    const raw = {
      headers: { Authorization: "Bearer top.secret/token", ordinary: "visible" },
      api_key: "sk-projectsupersecret",
      prompt: "use Bearer nested.secret/value then sess-sessionsecret",
    };
    const rawText = JSON.stringify(raw);
    const views = createPayloadViews(raw, { rawText });

    expect(views.raw).toBe(raw);
    expect(views.rawText).toBe(rawText);
    expect(views.display).toEqual({
      headers: { Authorization: "[REDACTED]", ordinary: "visible" },
      api_key: "[REDACTED]",
      prompt: "use [REDACTED] then [REDACTED]",
    });
    expect(raw.headers.Authorization).toBe("Bearer top.secret/token");
  });

  it("fails closed for circular or resource-exhausting display values", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(createPayloadViews(circular).display).toEqual({ self: "[CIRCULAR]" });
    expect(
      createPayloadViews({ nested: { token: "secret" } }, { maximumDepth: 0 }).display,
    ).toEqual({
      nested: "[REDACTION_LIMIT]",
    });
  });

  it("never mutates arbitrary JSON payloads", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (raw) => {
        const before = JSON.stringify(raw);
        const views = createPayloadViews(raw);
        expect(views.raw).toBe(raw);
        expect(JSON.stringify(raw)).toBe(before);
      }),
      { seed: 20260831 },
    );
  });
});
