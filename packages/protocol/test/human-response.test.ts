import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createProjectId,
  validateHumanResponseSubmission,
  validateResponseCommitDraft,
} from "../src/index.js";

const nowMs = 1_725_148_800_000;
const id = <Prefix extends "cmd" | "ses" | "inf" | "clm" | "ply">(prefix: Prefix) =>
  createProjectId(prefix, { nowMs, randomBytes: new Uint8Array(10) });

const submission = {
  schemaVersion: 1,
  commandId: id("cmd"),
  sessionId: id("ses"),
  inferenceId: id("inf"),
  claimId: id("clm"),
  playerId: id("ply"),
  expectedRevision: 1,
  draft: { kind: "tool", toolName: "shell", argumentsJson: '{"command":"pwd"}' },
};

describe("human response submission", () => {
  it("accepts strict semantic text and tool drafts", () => {
    expect(validateHumanResponseSubmission(submission).valid).toBe(true);
    expect(
      validateHumanResponseSubmission({ ...submission, draft: { kind: "text", text: "done" } })
        .valid,
    ).toBe(true);
  });

  it("rejects every missing command or tool field and arbitrary outer shapes", () => {
    const required = [
      "schemaVersion",
      "commandId",
      "sessionId",
      "inferenceId",
      "claimId",
      "playerId",
      "expectedRevision",
      "draft",
    ] as const;
    for (const field of required) {
      const entries = Object.entries(submission).filter(([key]) => key !== field);
      const result = validateHumanResponseSubmission(Object.fromEntries(entries));
      expect(result.valid, field).toBe(false);
    }
    for (const field of ["toolName", "argumentsJson"] as const) {
      const draft = Object.fromEntries(
        Object.entries(submission.draft).filter(([key]) => key !== field),
      );
      expect(validateHumanResponseSubmission({ ...submission, draft }).valid, field).toBe(false);
    }
    expect(validateHumanResponseSubmission({ ...submission, output: [] }).valid).toBe(false);
    expect(
      validateHumanResponseSubmission({
        ...submission,
        draft: { ...submission.draft, extra: true },
      }).valid,
    ).toBe(false);
  });

  it("rejects non-object and invalid JSON tool arguments", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.string(), fc.array(fc.jsonValue())),
        (argumentsValue) => {
          const argumentsJson = JSON.stringify(argumentsValue);
          expect(
            validateHumanResponseSubmission({
              ...submission,
              draft: { ...submission.draft, argumentsJson },
            }).valid,
          ).toBe(false);
        },
      ),
      { seed: 20260831 },
    );
  });
});

describe("gateway response commit draft", () => {
  it("accepts only supported message and function call items", () => {
    expect(
      validateResponseCommitDraft({
        output: [
          {
            id: "msg_upstream",
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hello" }],
          },
          {
            id: "item_upstream",
            type: "function_call",
            call_id: "call_upstream",
            name: "shell",
            arguments: '{"command":"pwd"}',
          },
        ],
      }).valid,
    ).toBe(true);
  });

  it("rejects missing IDs, call fields, arbitrary output items, and array arguments", () => {
    const invalidItems = [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "x" }] },
      { id: "x", type: "function_call", call_id: "c", arguments: "{}" },
      { id: "x", type: "function_call", call_id: "c", name: "shell", arguments: "[]" },
      { id: "x", type: "computer_call", action: {} },
    ];
    for (const item of invalidItems) {
      expect(validateResponseCommitDraft({ output: [item] }).valid).toBe(false);
    }
    expect(validateResponseCommitDraft({ output: [], arbitrary: true }).valid).toBe(false);
  });
});
