export { type CompanionOptions, createCompanion } from "./app.js";
export { nextProjectId } from "./domain-adapter.js";
export { CompanionError, type ProblemDetails } from "./problem.js";
export {
  type PendingResponse,
  type PendingState,
  type Session,
  SessionLedger,
} from "./session-ledger.js";
export { type ShutdownResult, shutdownCompanion } from "./shutdown.js";
export {
  encodeCompletedResponse,
  encodeSse,
  startHeartbeat,
  writeWithBackpressure,
} from "./sse.js";
