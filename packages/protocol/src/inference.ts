import type { CommandEnvelope, EventEnvelope } from "./envelope.js";
import type { ProjectId } from "./project-id.js";

export interface ClaimInferencePayload {
  readonly inferenceId: ProjectId<"inf">;
  readonly claimId: ProjectId<"clm">;
  readonly leaseDurationMs: number;
}

export interface RenewInferenceClaimPayload {
  readonly inferenceId: ProjectId<"inf">;
  readonly claimId: ProjectId<"clm">;
  readonly expectedRevision: number;
  readonly leaseDurationMs: number;
}

export interface ReleaseInferenceClaimPayload {
  readonly inferenceId: ProjectId<"inf">;
  readonly claimId: ProjectId<"clm">;
  readonly expectedRevision: number;
}

export interface CommitInferenceResponsePayload {
  readonly inferenceId: ProjectId<"inf">;
  readonly claimId: ProjectId<"clm">;
  readonly expectedRevision: number;
  readonly responseId: ProjectId<"rsp">;
  readonly responseDigest: `sha256:${string}`;
}

export type InferenceCommand =
  | CommandEnvelope<"inference.request.claim", ClaimInferencePayload>
  | CommandEnvelope<"inference.request.renew", RenewInferenceClaimPayload>
  | CommandEnvelope<"inference.request.release", ReleaseInferenceClaimPayload>
  | CommandEnvelope<"inference.response.commit", CommitInferenceResponsePayload>;

export type InferenceEvent = EventEnvelope<
  | "inference.request.claimed"
  | "inference.request.renewed"
  | "inference.request.released"
  | "inference.request.expired"
  | "inference.response.committed",
  Readonly<Record<string, unknown>>
>;
