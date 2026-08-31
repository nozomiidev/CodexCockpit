import { describe, expect, it } from "vitest";
import { type ModelRequest, previewEvents, redactWireJson, validateDraft } from "./domain";

const request: ModelRequest = {
  requestId: "req_test",
  model: "gpt-5.5",
  instructions: "",
  prompt: "",
  raw: "{}",
  tools: [
    {
      name: "shell",
      description: "",
      parameters: {
        type: "object",
        required: ["command"],
        properties: { command: { type: "string" } },
      },
    },
  ],
};

describe("response draft validation", () => {
  it("rejects invalid JSON and unadvertised tools", () => {
    expect(
      validateDraft({ kind: "tool", toolName: "shell", argumentsJson: "{" }, request),
    ).toHaveLength(1);
    expect(
      validateDraft({ kind: "tool", toolName: "other", argumentsJson: "{}" }, request)[0]?.field,
    ).toBe("toolName");
  });

  it("accepts non-empty text and object arguments", () => {
    expect(validateDraft({ kind: "text", text: "Done" }, request)).toEqual([]);
    expect(
      validateDraft(
        { kind: "tool", toolName: "shell", argumentsJson: '{"command":"pwd"}' },
        request,
      ),
    ).toEqual([]);
  });

  it("enforces required fields and nested JSON Schema constraints", () => {
    expect(
      validateDraft({ kind: "tool", toolName: "shell", argumentsJson: "{}" }, request)[0]?.field,
    ).toBe("command");
    expect(
      validateDraft(
        { kind: "tool", toolName: "shell", argumentsJson: '{"command":42}' },
        request,
      )[0]?.field,
    ).toBe("command");
  });

  it("redacts credential-shaped keys at every nesting level", () => {
    const displayed = redactWireJson(
      '{"input":"ok","client":{"api_key":"sk-secret","token":"bearer"}}',
    );
    expect(displayed).not.toContain("sk-secret");
    expect(displayed).not.toContain("bearer");
    expect(displayed).toContain("[REDACTED]");
    expect(
      redactWireJson(
        '{"note":"Authorization: Bearer abcdefghijklmnop","value":"sk-abcdefghijklmnop"}',
      ),
    ).not.toContain("abcdefghijklmnop");
  });

  it("always completes a generated event stream", () => {
    const events = previewEvents({ kind: "text", text: "hello" }).map(
      (event) => JSON.parse(event) as { type: string },
    );
    expect(events.at(-1)?.type).toBe("response.completed");
  });
});
