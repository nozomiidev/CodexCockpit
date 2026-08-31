# Debugging and observability

CodexCockpit crosses browser, transport, process, protocol, and filesystem boundaries. Every wait must reveal which boundary currently owns progress.

## Correlation model

Carry these identifiers through structured logs, diagnostic UI, events, and failure artifacts where applicable:

| Identifier             | Scope                                                    |
| ---------------------- | -------------------------------------------------------- |
| `sessionId`            | Pair of seats and their authoritative runtime            |
| `requestId`            | One logical Responses request across connection attempts |
| `responseId`           | One encoded model response                               |
| `commandId`            | One shell/tool command lifecycle                         |
| `eventId` / `sequence` | Durable event identity and session ordering              |
| `connectionId`         | One transient browser, Codex, or relay connection        |

Connection retries must not create a new logical request. Log IDs as fields, not embedded only in prose.

## Required lifecycle signals

Long operations expose a phase, monotonic elapsed duration, bounded deadline, completion/failure, and low-rate heartbeat when no natural progress event exists. Recommended phases are:

- companion: `starting`, `binding`, `runtime_ready`, `accepting_clients`, `stopping`;
- terminal: `queued`, `spawning`, `ready`, `streaming`, `draining`, `exited`;
- model request: `accepted`, `available`, `claimed`, `validated`, `streaming`, `completed`;
- reconnect: `disconnected`, `backing_off`, `connecting`, `resuming`, `synchronized`.

Record time separately for queueing, connection, execution, streaming, validation, persistence, and cleanup. Do not emit a log for every terminal chunk or token. Aggregate byte/event counts and backpressure duration at bounded intervals.

## Readiness and deadlines

Readiness means the process is listening and its required dependency is usable; a spawned PID alone is not ready. Local orchestration polls an explicit readiness endpoint or protocol notification with a bounded deadline. On timeout, report the last phase, elapsed time, child status, endpoint, recent structured logs, and reproducible command.

All external I/O accepts cancellation and has an explicit deadline. Retries report attempt number and classified reason. Process cleanup is idempotent and bounded; test helpers terminate owned children and report survivors.

## Failure triage

1. Find the failing `sessionId` and narrow to browser, companion, Codex, terminal, gateway, or persistence.
2. Compare the last phase with the expected lifecycle transition.
3. Confirm version/capability negotiation before inspecting payload details.
4. For transport failures, distinguish connect, resume, ordering, backpressure, and peer close.
5. For Responses failures, inspect the redacted request, validation result, emitted event ledger, and terminal SSE event. An EOF before `response.completed`, `response.failed`, or `response.incomplete` is a protocol defect.
6. For terminal failures, retain exit status, signal, backend, rows/columns, bytes in/out, and cleanup result. Decode bytes only at the presentation boundary.
7. For cross-window failures, compare each page's last sequence and transport state; the highest sequence is not evidence of authority unless it came from the session owner.

## Playwright artifacts

CI retains traces on first retry and screenshots/video on failure. Open a trace with:

```sh
pnpm exec playwright show-trace path/to/trace.zip
```

The trace should show URL/session parameters, accessible tree, network timeline, console errors, and the last visible connection/request state. A timeout lacking those clues is a defect in the test harness.

## Structured event example

```json
{
  "level": "info",
  "event": "inference.response.completed",
  "sessionId": "ses_0198f3c7-0000-7000-8000-000000000001",
  "requestId": "req_0198f3c7-0000-7000-8000-000000000002",
  "responseId": "rsp_0198f3c7-0000-7000-8000-000000000003",
  "sequence": 42,
  "durationMs": 817,
  "emittedEventCount": 4
}
```

Logs default to metadata. Raw prompts, terminal content, response bodies, environment values, and absolute host paths require an explicit local diagnostic mode and remain redacted from committed artifacts.
