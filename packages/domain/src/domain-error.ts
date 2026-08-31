export const domainErrorCodes = [
  "claim_already_held",
  "claim_not_held",
  "claim_expired",
  "claim_mismatch",
  "revision_conflict",
  "response_already_committed",
  "invalid_lease_duration",
  "invalid_response_digest",
  "event_history_invalid",
] as const;

export type DomainErrorCode = (typeof domainErrorCodes)[number];

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly context: Readonly<Record<string, string | number>>;

  constructor(
    code: DomainErrorCode,
    message: string,
    context: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.context = context;
  }
}
