import { createPayloadViews } from "@codex-cockpit/protocol";
import Ajv from "ajv";

export type Seat = "terminal" | "model";
export type Lens = "structured" | "raw" | "contract";
export type ConnectionState = "connected" | "reconnecting" | "offline";
export type RequestState = "waiting" | "claimed" | "drafting" | "valid" | "submitted";

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ModelRequest {
  readonly requestId: string;
  readonly model: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly tools: readonly ToolDefinition[];
  readonly raw: string;
}

export type ResponseDraft =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly toolName: string; readonly argumentsJson: string };

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly connection: ConnectionState;
  readonly requestState: RequestState;
  readonly request: ModelRequest;
  readonly draft: ResponseDraft;
  readonly sequence: number;
  readonly emittedEvents: readonly string[];
}

export function validateDraft(
  draft: ResponseDraft,
  request: ModelRequest,
): readonly ValidationIssue[] {
  if (draft.kind === "text") {
    return draft.text.trim()
      ? []
      : [{ field: "text", message: "モデルの出力内容を入力してください" }];
  }

  if (!request.tools.some((tool) => tool.name === draft.toolName)) {
    return [{ field: "toolName", message: "requestで許可されたtoolを選択してください" }];
  }
  try {
    const value: unknown = JSON.parse(draft.argumentsJson);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [{ field: "arguments", message: "argumentsはJSON objectである必要があります" }];
    }
    const tool = request.tools.find((candidate) => candidate.name === draft.toolName);
    if (tool) return validateSchemaObject(value, tool.parameters);
  } catch {
    return [{ field: "arguments", message: "有効なJSONではありません" }];
  }
  return [];
}

function validateSchemaObject(
  value: object,
  schema: Record<string, unknown>,
): readonly ValidationIssue[] {
  try {
    const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
    if (validate(value)) return [];
    return (validate.errors ?? []).map((error) => {
      const missing =
        error.keyword === "required" && "missingProperty" in error.params
          ? String(error.params.missingProperty)
          : undefined;
      const field = missing ?? (error.instancePath.replace(/^\//, "") || "arguments");
      return {
        field,
        message: missing
          ? `必須field「${missing}」がありません`
          : `${field}: ${error.message ?? "schemaに適合しません"}`,
      };
    });
  } catch {
    return [{ field: "schema", message: "tool schema自体が無効なため送信できません" }];
  }
}

export function redactWireJson(raw: string): string {
  try {
    const value: unknown = JSON.parse(raw);
    return JSON.stringify(createPayloadViews(value).display, null, 2);
  } catch {
    return "[unparseable wire payload]";
  }
}

export function previewEvents(draft: ResponseDraft): readonly string[] {
  const responseId = "resp_demo_01";
  if (draft.kind === "text") {
    return [
      JSON.stringify({ type: "response.created", response: { id: responseId } }),
      JSON.stringify({
        type: "response.output_text.delta",
        item_id: "msg_demo_01",
        delta: draft.text,
      }),
      JSON.stringify({
        type: "response.output_item.done",
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: draft.text }],
        },
      }),
      JSON.stringify({ type: "response.completed", response: { id: responseId } }),
    ];
  }
  return [
    JSON.stringify({ type: "response.created", response: { id: responseId } }),
    JSON.stringify({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call_demo_01",
        name: draft.toolName,
        arguments: draft.argumentsJson,
      },
    }),
    JSON.stringify({ type: "response.completed", response: { id: responseId } }),
  ];
}
