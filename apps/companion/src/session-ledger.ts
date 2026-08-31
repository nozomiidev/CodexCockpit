import type { InferenceResponseState } from "@codex-cockpit/domain";
import type { ProjectId } from "@codex-cockpit/protocol";
import {
  claimInference,
  commitInference,
  newInferenceState,
  nextProjectId,
} from "./domain-adapter.js";
import { CompanionError } from "./problem.js";

export type PendingState = "pending" | "claimed" | "committed" | "cancelled";

export interface Session {
  readonly id: string;
  readonly createdAt: string;
}

export interface PendingResponse {
  readonly id: string;
  readonly responseId: ProjectId<"rsp">;
  readonly sessionId: string;
  readonly request: Readonly<Record<string, unknown>>;
  readonly rawRequestText?: string;
  domainState: InferenceResponseState;
  committedResponseText?: string;
  state: PendingState;
  claimedBy?: string;
  readonly createdAt: string;
  updatedAt: string;
}

interface Waiter {
  readonly resolve: (value: Readonly<Record<string, unknown>>) => void;
  readonly reject: (reason: CompanionError) => void;
}

/** Single-process ledger. Its interface is deliberately persistence-neutral. */
export class SessionLedger {
  readonly #sessions = new Map<string, Session>();
  readonly #requests = new Map<string, PendingResponse>();
  readonly #waiters = new Map<string, Waiter>();

  createSession(): Session {
    if (this.#sessions.size >= 1_000) {
      throw new CompanionError(
        503,
        "session_capacity_reached",
        "Session capacity has been reached.",
      );
    }
    const session = { id: nextProjectId("ses"), createdAt: new Date().toISOString() };
    this.#sessions.set(session.id, session);
    return session;
  }

  getSession(sessionId: string): Session {
    const session = this.#sessions.get(sessionId);
    if (session === undefined)
      throw new CompanionError(404, "session_not_found", "Session was not found.");
    return session;
  }

  createPending(
    sessionId: string,
    request: Readonly<Record<string, unknown>>,
    rawRequestText?: string,
  ): PendingResponse {
    this.getSession(sessionId);
    this.#pruneTerminalRequests();
    if (this.#requests.size >= 10_000) {
      throw new CompanionError(
        503,
        "response_capacity_reached",
        "Response request capacity has been reached.",
      );
    }
    const now = new Date().toISOString();
    const domainState = newInferenceState();
    const pending: PendingResponse = {
      id: domainState.inferenceId,
      responseId: nextProjectId("rsp"),
      sessionId,
      request,
      ...(rawRequestText === undefined ? {} : { rawRequestText }),
      domainState,
      state: "pending",
      createdAt: now,
      updatedAt: now,
    };
    this.#requests.set(pending.id, pending);
    return pending;
  }

  listPending(sessionId: string): readonly PendingResponse[] {
    this.getSession(sessionId);
    return [...this.#requests.values()].filter(
      (item) =>
        item.sessionId === sessionId && (item.state === "pending" || item.state === "claimed"),
    );
  }

  getPending(sessionId: string, requestId: string): PendingResponse {
    this.getSession(sessionId);
    const pending = this.#requests.get(requestId);
    if (pending === undefined || pending.sessionId !== sessionId) {
      throw new CompanionError(
        404,
        "response_request_not_found",
        "Pending response request was not found.",
      );
    }
    return pending;
  }

  claim(sessionId: string, requestId: string, playerId: string): PendingResponse {
    const pending = this.getPending(sessionId, requestId);
    if (pending.state === "committed" || pending.state === "cancelled")
      throw new CompanionError(
        409,
        "response_request_not_claimable",
        "Response request is not claimable.",
      );
    pending.domainState = claimInference(pending.domainState, playerId);
    pending.state = pending.domainState.status;
    if (pending.domainState.status !== "claimed") {
      throw new CompanionError(
        500,
        "invalid_claim_transition",
        "Claim did not enter claimed state.",
      );
    }
    pending.claimedBy = pending.domainState.playerId;
    pending.updatedAt = new Date().toISOString();
    return pending;
  }

  commit(
    sessionId: string,
    requestId: string,
    playerId: string,
    response: Readonly<Record<string, unknown>>,
    authorization?: { readonly claimId: string; readonly expectedRevision: number },
  ): PendingResponse {
    const pending = this.getPending(sessionId, requestId);
    const responseText = JSON.stringify(response);
    if (pending.state === "committed") {
      if (pending.committedResponseText === responseText) return pending;
      throw new CompanionError(
        409,
        "response_already_committed",
        "A different response has already been committed.",
      );
    }
    if (pending.domainState.status !== "claimed" || pending.domainState.playerId !== playerId) {
      throw new CompanionError(
        409,
        "response_request_not_owned",
        "Claim the response request before committing it.",
      );
    }
    pending.domainState = commitInference(pending.domainState, pending.responseId, response, {
      claimId: authorization?.claimId ?? pending.domainState.claimId,
      playerId,
      expectedRevision: authorization?.expectedRevision ?? pending.domainState.revision,
    });
    pending.state = pending.domainState.status;
    pending.committedResponseText = responseText;
    pending.updatedAt = new Date().toISOString();
    this.#waiters.get(requestId)?.resolve(response);
    this.#waiters.delete(requestId);
    return pending;
  }

  cancel(sessionId: string, requestId: string): PendingResponse {
    const pending = this.getPending(sessionId, requestId);
    if (pending.state === "committed" || pending.state === "cancelled") {
      throw new CompanionError(
        409,
        "response_request_terminal",
        "Response request has already finished.",
      );
    }
    pending.state = "cancelled";
    pending.updatedAt = new Date().toISOString();
    this.#waiters
      .get(requestId)
      ?.reject(
        new CompanionError(409, "response_request_cancelled", "Response request was cancelled."),
      );
    this.#waiters.delete(requestId);
    return pending;
  }

  waitForCommit(
    requestId: string,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    return new Promise((resolve, reject) => {
      if (this.#waiters.has(requestId)) {
        reject(
          new CompanionError(409, "response_waiter_exists", "A response waiter already exists."),
        );
        return;
      }
      const onAbort = (): void => {
        this.#waiters.delete(requestId);
        reject(
          signal.reason instanceof CompanionError
            ? signal.reason
            : new CompanionError(499, "client_disconnected", "The requesting client disconnected."),
        );
      };
      const finish = (operation: () => void): void => {
        signal.removeEventListener("abort", onAbort);
        operation();
      };
      this.#waiters.set(requestId, {
        resolve: (value) => finish(() => resolve(value)),
        reject: (reason) => finish(() => reject(reason)),
      });
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  diagnostics(): {
    readonly sessions: number;
    readonly pendingResponses: number;
    readonly waiters: number;
  } {
    return {
      sessions: this.#sessions.size,
      pendingResponses: [...this.#requests.values()].filter(
        (item) => item.state === "pending" || item.state === "claimed",
      ).length,
      waiters: this.#waiters.size,
    };
  }

  #pruneTerminalRequests(): void {
    if (this.#requests.size < 10_000) return;
    for (const [requestId, request] of this.#requests) {
      if (request.state === "committed" || request.state === "cancelled") {
        this.#requests.delete(requestId);
        if (this.#requests.size < 9_000) return;
      }
    }
  }
}
