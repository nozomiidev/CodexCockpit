import type { ProjectId } from "@codex-cockpit/protocol";

import { DomainError } from "./domain-error.js";

export const minimumLeaseDurationMs = 1_000;
export const maximumLeaseDurationMs = 300_000;

export interface PendingInference {
  readonly status: "pending";
  readonly inferenceId: ProjectId<"inf">;
  readonly revision: number;
}

export interface ClaimedInference {
  readonly status: "claimed";
  readonly inferenceId: ProjectId<"inf">;
  readonly claimId: ProjectId<"clm">;
  readonly playerId: ProjectId<"ply">;
  readonly revision: number;
  readonly expiresAtMs: number;
}

export interface CommittedInference {
  readonly status: "committed";
  readonly inferenceId: ProjectId<"inf">;
  readonly responseId: ProjectId<"rsp">;
  readonly responseDigest: Sha256Digest;
  readonly committedBy: ProjectId<"ply">;
  readonly commitCommandId: ProjectId<"cmd">;
}

export type InferenceResponseState = PendingInference | ClaimedInference | CommittedInference;
/** Compatibility name for adapters; it is exactly the response lifecycle state. */
export type InferenceState = InferenceResponseState;

declare const sha256DigestBrand: unique symbol;
export type Sha256Digest = `sha256:${string}` & { readonly [sha256DigestBrand]: true };

export type InferenceDomainEvent =
  | {
      readonly type: "inference.request.claimed";
      readonly inferenceId: ProjectId<"inf">;
      readonly claimId: ProjectId<"clm">;
      readonly playerId: ProjectId<"ply">;
      readonly revision: number;
      readonly expiresAtMs: number;
    }
  | {
      readonly type: "inference.request.renewed";
      readonly inferenceId: ProjectId<"inf">;
      readonly claimId: ProjectId<"clm">;
      readonly playerId: ProjectId<"ply">;
      readonly revision: number;
      readonly expiresAtMs: number;
    }
  | {
      readonly type: "inference.request.released" | "inference.request.expired";
      readonly inferenceId: ProjectId<"inf">;
      readonly claimId: ProjectId<"clm">;
      readonly revision: number;
    }
  | {
      readonly type: "inference.response.committed";
      readonly inferenceId: ProjectId<"inf">;
      readonly claimId: ProjectId<"clm">;
      readonly revision: number;
      readonly responseId: ProjectId<"rsp">;
      readonly responseDigest: Sha256Digest;
      readonly playerId: ProjectId<"ply">;
      readonly commandId: ProjectId<"cmd">;
    };

export interface ClaimInferenceInput {
  readonly claimId: ProjectId<"clm">;
  readonly playerId: ProjectId<"ply">;
  readonly leaseDurationMs: number;
  readonly nowMs: number;
}

export interface MutateClaimInput {
  readonly claimId: ProjectId<"clm">;
  readonly playerId: ProjectId<"ply">;
  readonly expectedRevision: number;
  readonly nowMs: number;
}

export interface RenewInferenceClaimInput extends MutateClaimInput {
  readonly leaseDurationMs: number;
}

export interface CommitInferenceResponseInput extends MutateClaimInput {
  readonly commandId: ProjectId<"cmd">;
  readonly responseId: ProjectId<"rsp">;
  readonly responseDigest: string;
}

export function pendingInference(inferenceId: ProjectId<"inf">): PendingInference {
  return { status: "pending", inferenceId, revision: 0 };
}

export function parseSha256Digest(value: string): Sha256Digest {
  if (!isSha256Digest(value)) {
    throw new DomainError(
      "invalid_response_digest",
      "Response digest must be sha256 followed by 64 lowercase hexadecimal characters",
    );
  }
  return value;
}

export function isSha256Digest(value: string): value is Sha256Digest {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

export function decideClaim(
  state: InferenceResponseState,
  input: ClaimInferenceInput,
): readonly InferenceDomainEvent[] {
  assertTime(input.nowMs);
  assertLeaseDuration(input.leaseDurationMs);
  if (state.status === "committed") {
    throw new DomainError("response_already_committed", "The inference already has a response");
  }

  const claimedEvent: InferenceDomainEvent = {
    type: "inference.request.claimed",
    inferenceId: state.inferenceId,
    claimId: input.claimId,
    playerId: input.playerId,
    revision: state.revision + 1,
    expiresAtMs: input.nowMs + input.leaseDurationMs,
  };

  if (state.status === "pending") {
    return [claimedEvent];
  }
  if (input.nowMs < state.expiresAtMs) {
    throw new DomainError("claim_already_held", "Another active claim owns this inference", {
      expiresAtMs: state.expiresAtMs,
      revision: state.revision,
    });
  }
  return [
    {
      type: "inference.request.expired",
      inferenceId: state.inferenceId,
      claimId: state.claimId,
      revision: state.revision,
    },
    claimedEvent,
  ];
}

export function decideRenewClaim(
  state: InferenceResponseState,
  input: RenewInferenceClaimInput,
): readonly InferenceDomainEvent[] {
  const claim = requireActiveClaim(state, input);
  assertLeaseDuration(input.leaseDurationMs);
  return [
    {
      type: "inference.request.renewed",
      inferenceId: claim.inferenceId,
      claimId: claim.claimId,
      playerId: claim.playerId,
      revision: claim.revision + 1,
      expiresAtMs: input.nowMs + input.leaseDurationMs,
    },
  ];
}

export function decideReleaseClaim(
  state: InferenceResponseState,
  input: MutateClaimInput,
): readonly InferenceDomainEvent[] {
  const claim = requireActiveClaim(state, input);
  return [
    {
      type: "inference.request.released",
      inferenceId: claim.inferenceId,
      claimId: claim.claimId,
      revision: claim.revision,
    },
  ];
}

export function decideCommitResponse(
  state: InferenceResponseState,
  input: CommitInferenceResponseInput,
): readonly InferenceDomainEvent[] {
  const digest = parseSha256Digest(input.responseDigest);
  if (state.status === "committed") {
    if (
      state.commitCommandId === input.commandId &&
      state.responseId === input.responseId &&
      state.responseDigest === digest
    ) {
      return [];
    }
    throw new DomainError(
      "response_already_committed",
      "A different response was already committed",
    );
  }
  const claim = requireActiveClaim(state, input);
  return [
    {
      type: "inference.response.committed",
      inferenceId: claim.inferenceId,
      claimId: claim.claimId,
      revision: claim.revision,
      responseId: input.responseId,
      responseDigest: digest,
      playerId: claim.playerId,
      commandId: input.commandId,
    },
  ];
}

/** Rebuilds inference state solely from its ordered event history. */
export function reduceInferenceEvents(
  initialState: InferenceResponseState,
  events: readonly InferenceDomainEvent[],
): InferenceResponseState {
  let state: InferenceResponseState = initialState;
  for (const event of events) {
    state = applyInferenceEvent(state, event);
  }
  return state;
}

export function applyInferenceEvent(
  state: InferenceResponseState,
  event: InferenceDomainEvent,
): InferenceResponseState {
  if (event.inferenceId !== state.inferenceId) {
    throw invalidHistory("Event belongs to a different inference");
  }
  switch (event.type) {
    case "inference.request.claimed":
      if (state.status === "committed") {
        throw invalidHistory("A committed inference cannot be claimed");
      }
      if (event.revision !== state.revision + 1) {
        throw invalidHistory("A claim must advance the inference revision exactly once");
      }
      return {
        status: "claimed",
        inferenceId: event.inferenceId,
        claimId: event.claimId,
        playerId: event.playerId,
        revision: event.revision,
        expiresAtMs: event.expiresAtMs,
      };
    case "inference.request.renewed":
      assertEventClaim(state, event.claimId, event.revision - 1);
      return {
        status: "claimed",
        inferenceId: event.inferenceId,
        claimId: event.claimId,
        playerId: event.playerId,
        revision: event.revision,
        expiresAtMs: event.expiresAtMs,
      };
    case "inference.request.released":
    case "inference.request.expired":
      assertEventClaim(state, event.claimId, event.revision);
      return {
        status: "pending",
        inferenceId: state.inferenceId,
        revision: event.revision,
      };
    case "inference.response.committed":
      assertEventClaim(state, event.claimId, event.revision);
      return {
        status: "committed",
        inferenceId: event.inferenceId,
        responseId: event.responseId,
        responseDigest: event.responseDigest,
        committedBy: event.playerId,
        commitCommandId: event.commandId,
      };
  }
}

function requireActiveClaim(
  state: InferenceResponseState,
  input: MutateClaimInput,
): ClaimedInference {
  assertTime(input.nowMs);
  if (state.status !== "claimed") {
    throw new DomainError("claim_not_held", "The inference has no active claim");
  }
  if (state.claimId !== input.claimId || state.playerId !== input.playerId) {
    throw new DomainError("claim_mismatch", "The claim is owned by another player or lease");
  }
  if (state.revision !== input.expectedRevision) {
    throw new DomainError("revision_conflict", "The claim revision is stale", {
      actualRevision: state.revision,
      expectedRevision: input.expectedRevision,
    });
  }
  if (input.nowMs >= state.expiresAtMs) {
    throw new DomainError("claim_expired", "The claim lease has expired", {
      expiresAtMs: state.expiresAtMs,
    });
  }
  return state;
}

function assertEventClaim(
  state: InferenceResponseState,
  claimId: ProjectId<"clm">,
  expectedRevision: number,
): asserts state is ClaimedInference {
  if (
    state.status !== "claimed" ||
    state.claimId !== claimId ||
    state.revision !== expectedRevision
  ) {
    throw invalidHistory("Event does not match the active claim revision");
  }
}

function assertLeaseDuration(leaseDurationMs: number): void {
  if (
    !Number.isSafeInteger(leaseDurationMs) ||
    leaseDurationMs < minimumLeaseDurationMs ||
    leaseDurationMs > maximumLeaseDurationMs
  ) {
    throw new DomainError(
      "invalid_lease_duration",
      `Lease duration must be an integer from ${minimumLeaseDurationMs} to ${maximumLeaseDurationMs} ms`,
      { leaseDurationMs },
    );
  }
}

function assertTime(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError("nowMs must be a non-negative safe integer");
  }
}

function invalidHistory(message: string): DomainError {
  return new DomainError("event_history_invalid", message);
}
