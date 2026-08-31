import { isProjectId, type ProjectId } from "./project-id.js";

export interface OutputTextContent {
  readonly type: "output_text";
  readonly text: string;
}

export interface AssistantMessageItem {
  readonly id: string;
  readonly type: "message";
  readonly role: "assistant";
  readonly content: readonly OutputTextContent[];
}

export interface FunctionCallItem {
  readonly id: string;
  readonly type: "function_call";
  readonly call_id: string;
  readonly name: string;
  readonly arguments: string;
}

export type ResponseItem = AssistantMessageItem | FunctionCallItem;

/** Gateway-internal response after system-owned IDs have been assigned. */
export interface ResponseCommitDraft {
  readonly output: readonly ResponseItem[];
}

export type HumanResponseDraft =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly toolName: string; readonly argumentsJson: string };

/** Semantic right-player submission. The gateway, not the player, creates upstream item IDs. */
export interface HumanResponseSubmission {
  readonly schemaVersion: 1;
  readonly commandId: ProjectId<"cmd">;
  readonly sessionId: ProjectId<"ses">;
  readonly inferenceId: ProjectId<"inf">;
  readonly claimId: ProjectId<"clm">;
  readonly playerId: ProjectId<"ply">;
  readonly expectedRevision: number;
  readonly draft: HumanResponseDraft;
}

export interface ProtocolValidationIssue {
  readonly path: string;
  readonly code: "missing_field" | "unexpected_field" | "invalid_type" | "invalid_value";
  readonly message: string;
}

export type ProtocolValidationResult<Value> =
  | { readonly valid: true; readonly value: Value; readonly issues: readonly [] }
  | { readonly valid: false; readonly issues: readonly ProtocolValidationIssue[] };

export function validateResponseCommitDraft(
  value: unknown,
): ProtocolValidationResult<ResponseCommitDraft> {
  if (!hasExactKeys(value, ["output"])) {
    return invalidShape(value, ["output"], "$", "Response commit must contain only output");
  }
  if (!Array.isArray(value.output) || value.output.length === 0) {
    return invalid("$.output", "invalid_value", "output must be a non-empty array");
  }
  for (let index = 0; index < value.output.length; index += 1) {
    const issue = validateResponseItem(value.output[index], `$.output[${index}]`);
    if (issue !== undefined) return { valid: false, issues: [issue] };
  }
  if (!value.output.every(isResponseItem)) {
    return invalid("$.output", "invalid_value", "output contains an invalid response item");
  }
  return { valid: true, value: { output: value.output }, issues: [] };
}

export function isResponseCommitDraft(value: unknown): value is ResponseCommitDraft {
  return validateResponseCommitDraft(value).valid;
}

export function validateHumanResponseSubmission(
  value: unknown,
): ProtocolValidationResult<HumanResponseSubmission> {
  const keys = [
    "schemaVersion",
    "commandId",
    "sessionId",
    "inferenceId",
    "claimId",
    "playerId",
    "expectedRevision",
    "draft",
  ] as const;
  if (!hasExactKeys(value, keys)) {
    return invalidShape(value, keys, "$", "Submission fields do not match the v1 contract");
  }
  if (value.schemaVersion !== 1) {
    return invalid("$.schemaVersion", "invalid_value", "Only schemaVersion 1 is supported");
  }
  if (typeof value.commandId !== "string" || !isProjectId(value.commandId, "cmd"))
    return invalid("$.commandId", "invalid_value", "commandId must be a cmd_ UUIDv7");
  if (typeof value.sessionId !== "string" || !isProjectId(value.sessionId, "ses"))
    return invalid("$.sessionId", "invalid_value", "sessionId must be a ses_ UUIDv7");
  if (typeof value.inferenceId !== "string" || !isProjectId(value.inferenceId, "inf"))
    return invalid("$.inferenceId", "invalid_value", "inferenceId must be an inf_ UUIDv7");
  if (typeof value.claimId !== "string" || !isProjectId(value.claimId, "clm"))
    return invalid("$.claimId", "invalid_value", "claimId must be a clm_ UUIDv7");
  if (typeof value.playerId !== "string" || !isProjectId(value.playerId, "ply"))
    return invalid("$.playerId", "invalid_value", "playerId must be a ply_ UUIDv7");
  if (
    typeof value.expectedRevision !== "number" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1
  ) {
    return invalid(
      "$.expectedRevision",
      "invalid_value",
      "expectedRevision must be a positive safe integer",
    );
  }
  const draftIssue = validateHumanDraft(value.draft);
  if (draftIssue !== undefined) return { valid: false, issues: [draftIssue] };
  if (!isHumanDraft(value.draft)) {
    return invalid("$.draft", "invalid_value", "draft is invalid");
  }
  return {
    valid: true,
    value: {
      schemaVersion: 1,
      commandId: value.commandId,
      sessionId: value.sessionId,
      inferenceId: value.inferenceId,
      claimId: value.claimId,
      playerId: value.playerId,
      expectedRevision: value.expectedRevision,
      draft: value.draft,
    },
    issues: [],
  };
}

export function isHumanResponseSubmission(value: unknown): value is HumanResponseSubmission {
  return validateHumanResponseSubmission(value).valid;
}

function validateHumanDraft(value: unknown): ProtocolValidationIssue | undefined {
  if (!isRecord(value)) return issue("$.draft", "invalid_type", "draft must be an object");
  if (value["kind"] === "text") {
    if (!hasExactKeys(value, ["kind", "text"])) {
      return shapeIssue(value, ["kind", "text"], "$.draft", "Text draft fields are invalid");
    }
    if (!isNonEmptyString(value.text)) {
      return issue("$.draft.text", "invalid_value", "text must not be empty");
    }
    return undefined;
  }
  if (value["kind"] === "tool") {
    if (!hasExactKeys(value, ["kind", "toolName", "argumentsJson"])) {
      return shapeIssue(
        value,
        ["kind", "toolName", "argumentsJson"],
        "$.draft",
        "Tool draft fields are invalid",
      );
    }
    if (!isNonEmptyString(value.toolName)) {
      return issue("$.draft.toolName", "invalid_value", "toolName must not be empty");
    }
    if (!isJsonObjectString(value.argumentsJson)) {
      return issue(
        "$.draft.argumentsJson",
        "invalid_value",
        "argumentsJson must encode a JSON object",
      );
    }
    return undefined;
  }
  return issue("$.draft.kind", "invalid_value", "kind must be text or tool");
}

function isHumanDraft(value: unknown): value is HumanResponseDraft {
  return validateHumanDraft(value) === undefined;
}

function validateResponseItem(value: unknown, path: string): ProtocolValidationIssue | undefined {
  if (!isRecord(value)) return issue(path, "invalid_type", "Response item must be an object");
  if (value["type"] === "message") {
    if (!hasExactKeys(value, ["id", "type", "role", "content"])) {
      return shapeIssue(
        value,
        ["id", "type", "role", "content"],
        path,
        "Message fields are invalid",
      );
    }
    if (!isNonEmptyString(value.id) || value.role !== "assistant") {
      return issue(path, "invalid_value", "Message requires id and assistant role");
    }
    if (!Array.isArray(value.content) || value.content.length === 0) {
      return issue(`${path}.content`, "invalid_value", "Message content must be non-empty");
    }
    for (let index = 0; index < value.content.length; index += 1) {
      const content = value.content[index];
      if (
        !hasExactKeys(content, ["type", "text"]) ||
        content.type !== "output_text" ||
        !isNonEmptyString(content.text)
      ) {
        return issue(
          `${path}.content[${index}]`,
          "invalid_value",
          "Content requires output_text and non-empty text",
        );
      }
    }
    return undefined;
  }
  if (value["type"] === "function_call") {
    const keys = ["id", "type", "call_id", "name", "arguments"] as const;
    if (!hasExactKeys(value, keys)) {
      return shapeIssue(value, keys, path, "Function call fields are invalid");
    }
    if (
      !isNonEmptyString(value.id) ||
      !isNonEmptyString(value.call_id) ||
      !isNonEmptyString(value.name)
    ) {
      return issue(path, "invalid_value", "Function call requires id, call_id, and name");
    }
    if (!isJsonObjectString(value.arguments)) {
      return issue(
        `${path}.arguments`,
        "invalid_value",
        "Function arguments must encode a JSON object",
      );
    }
    return undefined;
  }
  return issue(`${path}.type`, "invalid_value", "Unsupported response item type");
}

function isResponseItem(value: unknown): value is ResponseItem {
  return validateResponseItem(value, "$") === undefined;
}

function isJsonObjectString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed);
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalid<Value>(
  path: string,
  code: ProtocolValidationIssue["code"],
  message: string,
): ProtocolValidationResult<Value> {
  return { valid: false, issues: [issue(path, code, message)] };
}

function invalidShape<Value>(
  value: unknown,
  keys: readonly string[],
  path: string,
  message: string,
): ProtocolValidationResult<Value> {
  return { valid: false, issues: [shapeIssue(value, keys, path, message)] };
}

function shapeIssue(
  value: unknown,
  keys: readonly string[],
  path: string,
  message: string,
): ProtocolValidationIssue {
  if (!isRecord(value)) return issue(path, "invalid_type", message);
  const missing = keys.find((key) => !Object.hasOwn(value, key));
  return missing === undefined
    ? issue(path, "unexpected_field", message)
    : issue(`${path}.${missing}`, "missing_field", message);
}

function issue(
  path: string,
  code: ProtocolValidationIssue["code"],
  message: string,
): ProtocolValidationIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is { readonly [Key in Keys[number]]: unknown } {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
