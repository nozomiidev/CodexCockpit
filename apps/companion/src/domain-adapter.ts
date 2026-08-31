import { createHash, randomBytes } from "node:crypto";
import {
  DomainError,
  decideClaim,
  decideCommitResponse,
  type InferenceResponseState,
  pendingInference,
  reduceInferenceEvents,
} from "@codex-cockpit/domain";
import {
  createProjectId,
  type ProjectId,
  type ProjectIdPrefix,
  parseProjectId,
} from "@codex-cockpit/protocol";
import { CompanionError } from "./problem.js";

/** Runtime entropy adapter; shared protocol construction stays deterministic. */
export function nextProjectId<Prefix extends ProjectIdPrefix>(prefix: Prefix): ProjectId<Prefix> {
  return createProjectId(prefix, { nowMs: Date.now(), randomBytes: randomBytes(10) });
}

export function newInferenceState(): InferenceResponseState {
  return pendingInference(nextProjectId("inf"));
}

export function claimInference(
  state: InferenceResponseState,
  playerIdValue: string,
): InferenceResponseState {
  try {
    return reduceInferenceEvents(
      state,
      decideClaim(state, {
        claimId: nextProjectId("clm"),
        playerId: parseProjectId(playerIdValue, "ply"),
        leaseDurationMs: 60_000,
        nowMs: Date.now(),
      }),
    );
  } catch (error) {
    throw translateDomainError(error);
  }
}

export function commitInference(
  state: InferenceResponseState,
  responseId: ProjectId<"rsp">,
  response: Readonly<Record<string, unknown>>,
  authorization: {
    readonly claimId: string;
    readonly playerId: string;
    readonly expectedRevision: number;
  },
): InferenceResponseState {
  if (state.status !== "claimed") {
    throw new CompanionError(
      409,
      "response_request_not_owned",
      "Claim the response request first.",
    );
  }
  try {
    const digest = `sha256:${createHash("sha256").update(JSON.stringify(response)).digest("hex")}`;
    return reduceInferenceEvents(
      state,
      decideCommitResponse(state, {
        claimId: parseProjectId(authorization.claimId, "clm"),
        playerId: parseProjectId(authorization.playerId, "ply"),
        expectedRevision: authorization.expectedRevision,
        nowMs: Date.now(),
        commandId: nextProjectId("cmd"),
        responseId,
        responseDigest: digest,
      }),
    );
  } catch (error) {
    throw translateDomainError(error);
  }
}

function translateDomainError(error: unknown): CompanionError {
  if (error instanceof DomainError) return new CompanionError(409, error.code, error.message);
  if (error instanceof TypeError || error instanceof RangeError) {
    return new CompanionError(400, "invalid_domain_identifier", error.message);
  }
  return new CompanionError(500, "domain_transition_failed", "Domain transition failed.");
}
