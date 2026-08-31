import { isProjectId, type ProjectId } from "./project-id.js";

/** Authoritative lease coordinates returned after a successful claim. */
export interface InferenceClaimReceipt {
  readonly schemaVersion: 1;
  readonly sessionId: ProjectId<"ses">;
  readonly inferenceId: ProjectId<"inf">;
  readonly claimId: ProjectId<"clm">;
  readonly playerId: ProjectId<"ply">;
  readonly revision: number;
  readonly leaseExpiresAt: string;
}

export function isInferenceClaimReceipt(value: unknown): value is InferenceClaimReceipt {
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "sessionId",
      "inferenceId",
      "claimId",
      "playerId",
      "revision",
      "leaseExpiresAt",
    ])
  ) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    typeof value.sessionId === "string" &&
    isProjectId(value.sessionId, "ses") &&
    typeof value.inferenceId === "string" &&
    isProjectId(value.inferenceId, "inf") &&
    typeof value.claimId === "string" &&
    isProjectId(value.claimId, "clm") &&
    typeof value.playerId === "string" &&
    isProjectId(value.playerId, "ply") &&
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    typeof value.leaseExpiresAt === "string" &&
    isUtcDateTime(value.leaseExpiresAt)
  );
}

function isUtcDateTime(value: string): boolean {
  if (
    !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/.test(
      value,
    )
  )
    return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = daysByMonth[month - 1];
  return maximumDay !== undefined && day <= maximumDay;
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
