import { isProjectId, type ProjectId } from "./project-id.js";

export const currentSchemaVersion = 1 as const;

export type ActorRole = "workspace-player" | "model-player" | "system";

export interface Actor {
  readonly role: ActorRole;
  readonly playerId?: ProjectId<"ply">;
}

export interface CommandEnvelope<Type extends string = string, Payload = unknown> {
  readonly schemaVersion: typeof currentSchemaVersion;
  readonly commandId: ProjectId<"cmd">;
  readonly sessionId: ProjectId<"ses">;
  readonly correlationId: ProjectId<"req">;
  readonly actor: Actor;
  readonly type: Type;
  readonly sentAt: string;
  readonly payload: Payload;
}

export interface EventEnvelope<Type extends string = string, Payload = unknown> {
  readonly schemaVersion: typeof currentSchemaVersion;
  readonly eventId: ProjectId<"evt">;
  readonly sessionId: ProjectId<"ses">;
  readonly seq: number;
  readonly causationId: ProjectId<"cmd">;
  readonly correlationId: ProjectId<"req">;
  readonly actor: Actor;
  readonly type: Type;
  readonly occurredAt: string;
  readonly payload: Payload;
}

export function isCommandEnvelope(value: unknown): value is CommandEnvelope {
  if (!isRecordWithExactKeys(value, commandEnvelopeKeys)) {
    return false;
  }
  return (
    value.schemaVersion === currentSchemaVersion &&
    typeof value.commandId === "string" &&
    isProjectId(value.commandId, "cmd") &&
    typeof value.sessionId === "string" &&
    isProjectId(value.sessionId, "ses") &&
    typeof value.correlationId === "string" &&
    isProjectId(value.correlationId, "req") &&
    isActor(value.actor) &&
    typeof value.type === "string" &&
    dottedTypePattern.test(value.type) &&
    typeof value.sentAt === "string" &&
    isRfc3339DateTime(value.sentAt) &&
    isRecord(value.payload)
  );
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (!isRecordWithExactKeys(value, eventEnvelopeKeys)) {
    return false;
  }
  return (
    value.schemaVersion === currentSchemaVersion &&
    typeof value.eventId === "string" &&
    isProjectId(value.eventId, "evt") &&
    typeof value.sessionId === "string" &&
    isProjectId(value.sessionId, "ses") &&
    typeof value.seq === "number" &&
    Number.isSafeInteger(value.seq) &&
    value.seq >= 1 &&
    typeof value.causationId === "string" &&
    isProjectId(value.causationId, "cmd") &&
    typeof value.correlationId === "string" &&
    isProjectId(value.correlationId, "req") &&
    isActor(value.actor) &&
    typeof value.type === "string" &&
    dottedTypePattern.test(value.type) &&
    typeof value.occurredAt === "string" &&
    isRfc3339DateTime(value.occurredAt) &&
    isRecord(value.payload)
  );
}

const dottedTypePattern = /^[a-z]+(?:\.[a-z]+)+$/;
const rfc3339Pattern =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const commandEnvelopeKeys = [
  "schemaVersion",
  "commandId",
  "sessionId",
  "correlationId",
  "actor",
  "type",
  "sentAt",
  "payload",
] as const;
const eventEnvelopeKeys = [
  "schemaVersion",
  "eventId",
  "sessionId",
  "seq",
  "causationId",
  "correlationId",
  "actor",
  "type",
  "occurredAt",
  "payload",
] as const;

function isRfc3339DateTime(value: string): boolean {
  if (!rfc3339Pattern.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = daysByMonth[month - 1];
  return maximumDay !== undefined && day <= maximumDay;
}

function isActor(value: unknown): value is Actor {
  if (!isActorRecord(value)) {
    return false;
  }
  if (
    value.role !== "workspace-player" &&
    value.role !== "model-player" &&
    value.role !== "system"
  ) {
    return false;
  }
  return (
    value.playerId === undefined ||
    (typeof value.playerId === "string" && isProjectId(value.playerId, "ply"))
  );
}

function isActorRecord(
  value: unknown,
): value is { readonly role: unknown; readonly playerId?: unknown } {
  if (!isRecord(value) || !Object.hasOwn(value, "role")) {
    return false;
  }
  return Object.keys(value).every((key) => key === "role" || key === "playerId");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordWithExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  expectedKeys: Keys,
): value is { readonly [Key in Keys[number]]: unknown } {
  return (
    isRecord(value) &&
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}
