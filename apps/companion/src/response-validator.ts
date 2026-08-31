import { validateResponseCommitDraft } from "@codex-cockpit/protocol";
import { CompanionError } from "./problem.js";

export function validateResponsesRequest(request: Readonly<Record<string, unknown>>): void {
  if (request["stream"] !== true)
    throw new CompanionError(400, "unsupported_response_mode", "Responses requests must stream.");
  if (typeof request["model"] !== "string" || request["model"].length === 0)
    throw new CompanionError(400, "invalid_responses_request", "model must be a string.");
}

export function validateCommittedResponse(
  request: Readonly<Record<string, unknown>>,
  response: Readonly<Record<string, unknown>>,
): void {
  const validated = validateResponseCommitDraft(response);
  if (!validated.valid) {
    invalid(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  const output = validated.value.output;
  const offeredTools = toolNames(request["tools"]);
  const ids = new Set<string>();
  for (const item of output) {
    if (!isRecord(item)) invalid("Every output item must be an object.");
    const id = requiredString(item, "id");
    if (ids.has(id)) invalid("Output item IDs must be unique.");
    ids.add(id);
    const type = requiredString(item, "type");
    if (type === "message") validateMessage(item);
    else if (type === "function_call") validateFunctionCall(item, offeredTools);
    else invalid(`Unsupported output item type: ${type}`);
  }
}

function validateMessage(item: Readonly<Record<string, unknown>>): void {
  if (item["role"] !== "assistant") invalid("Message role must be assistant.");
  const content = item["content"];
  if (!Array.isArray(content) || content.length === 0)
    invalid("Message content must not be empty.");
  for (const part of content) {
    if (!isRecord(part) || part["type"] !== "output_text" || typeof part["text"] !== "string")
      invalid("Message content must contain output_text with string text.");
  }
}

function validateFunctionCall(
  item: Readonly<Record<string, unknown>>,
  offeredTools: ReadonlySet<string>,
): void {
  requiredString(item, "call_id");
  const name = requiredString(item, "name");
  if (!offeredTools.has(name)) invalid(`Function ${name} was not offered by the request.`);
  const argumentsText = requiredString(item, "arguments");
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    if (!isRecord(parsed)) invalid("Function arguments must encode a JSON object.");
  } catch (error) {
    if (error instanceof CompanionError) throw error;
    invalid("Function arguments must be valid JSON.");
  }
}

function toolNames(value: unknown): ReadonlySet<string> {
  const names = new Set<string>();
  if (!Array.isArray(value)) return names;
  for (const tool of value) {
    if (isRecord(tool) && typeof tool["name"] === "string") names.add(tool["name"]);
  }
  return names;
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) invalid(`${key} must be a string.`);
  return value;
}

function invalid(message: string): never {
  throw new CompanionError(400, "invalid_response_output", message);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
