import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  FileCode2,
  Gauge,
  Layers3,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Users,
  Wrench,
} from "lucide-react";
import {
  type CompositionEvent,
  type KeyboardEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { type Lens, previewEvents, redactWireJson, type Seat, validateDraft } from "./domain";
import { useSessionStore } from "./session-store";

interface CockpitProps {
  readonly sessionId: string;
  readonly seat: Seat;
  readonly dual: boolean;
}

const lensLabels: Record<Lens, string> = {
  structured: "Structured",
  raw: "Raw wire",
  contract: "Tool contract",
};
const JsonEditor = lazy(() => import("./json-editor"));
const TerminalView = lazy(() => import("./terminal-view"));

function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const parent = event.currentTarget.parentElement;
  if (!parent) return;
  const tabs = Array.from(parent.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const current = tabs.indexOf(event.currentTarget);
  if (current < 0 || tabs.length === 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  tabs[next]?.click();
}

function Brand({ sessionId }: { readonly sessionId: string }) {
  return (
    <header className="topbar">
      <Link className="brand" to={`/sessions/${sessionId}/solo`} aria-label="Codex Cockpit home">
        <span className="brand-mark">
          <Layers3 size={17} />
        </span>
        <span>
          CODEX <b>COCKPIT</b>
        </span>
        <h1 className="sr-only">Codex Cockpit</h1>
      </Link>
      <div className="mission">
        <span>MISSION</span>
        <b>First Contact</b>
        <small>{sessionId}</small>
      </div>
      <div className="status-cluster">
        <span
          className="status-pill"
          data-testid="connection-status"
          role="status"
          aria-label="Connection status: connected local demo"
        >
          <Radio size={13} /> LOCAL DEMO
        </span>
        <span className="metric">
          <small>TURN</small>
          <b>01</b>
        </span>
        <span className="metric">
          <small>SCORE</small>
          <b>—</b>
        </span>
      </div>
    </header>
  );
}

function SeatNav({ sessionId, seat }: { readonly sessionId: string; readonly seat: Seat }) {
  return (
    <nav className="seat-nav" aria-label="Cockpit seats">
      <Link
        data-testid="role-tab-left"
        aria-label="Terminal · left seat"
        aria-current={seat === "terminal" ? "page" : undefined}
        to={`/sessions/${sessionId}/terminal`}
      >
        <TerminalSquare size={16} />
        <span>
          <small>LEFT SEAT</small>Harness operator
        </span>
      </Link>
      <div className="signal-line">
        <span />
        <CircleDot size={12} />
        <span />
      </div>
      <Link
        data-testid="role-tab-right"
        aria-label="Model · right seat"
        aria-current={seat === "model" ? "page" : undefined}
        to={`/sessions/${sessionId}/model`}
      >
        <Sparkles size={16} />
        <span>
          <small>RIGHT SEAT</small>Human model
        </span>
      </Link>
    </nav>
  );
}

function TerminalPanel() {
  const nextLineId = useRef(10);
  const [command, setCommand] = useState("");
  const transport = useSessionStore((state) => state.transport);
  const submitPrompt = useSessionStore((state) => state.submitPrompt);
  const [history, setHistory] = useState<readonly { readonly id: number; readonly text: string }[]>(
    [
      { id: 1, text: "$ codex" },
      { id: 2, text: "╭──────────────────────────────────────────────╮" },
      { id: 3, text: "│  OpenAI Codex · connected to cockpit        │" },
      { id: 4, text: "╰──────────────────────────────────────────────╯" },
      { id: 5, text: "" },
      { id: 6, text: "› READMEの未完了タスクを確認して、最初の一つを実装してください。" },
      { id: 7, text: "" },
      { id: 8, text: "  Waiting for model response…" },
    ],
  );

  function sendPrompt() {
    const next = command.trim();
    if (!next) return;
    const firstId = nextLineId.current;
    nextLineId.current += 3;
    setHistory((current) => [
      ...current,
      { id: firstId, text: `› ${next}` },
      { id: firstId + 1, text: "" },
      { id: firstId + 2, text: "  Waiting for model response…" },
    ]);
    setCommand("");
    void submitPrompt(next);
  }

  return (
    <section className="panel terminal-panel" data-testid="terminal" aria-label="Codex terminal">
      <div className="panel-title">
        <span>
          <TerminalSquare size={15} /> WORKSPACE TERMINAL
        </span>
        <small>
          ~/cockpit-lab <i>main</i>
        </small>
      </div>
      <div className="terminal-output" aria-live="polite">
        {transport ? (
          <Suspense fallback={<div>Loading terminal…</div>}>
            <TerminalView transport={transport} />
          </Suspense>
        ) : (
          history.map((line) => (
            <div className={line.text.includes("Waiting") ? "waiting-line" : ""} key={line.id}>
              {line.text || "\u00a0"}
            </div>
          ))
        )}
      </div>
      <div className="prompt-row">
        <ChevronRight size={17} />
        <textarea
          data-testid="prompt-input"
          aria-label="Codex prompt"
          rows={1}
          placeholder="Codexへ指示を送る…"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              sendPrompt();
            }
          }}
        />
        <button
          type="button"
          data-testid="prompt-send"
          className="icon-button"
          onClick={sendPrompt}
          aria-label="Send prompt"
        >
          <ArrowRight size={17} />
        </button>
      </div>
      <footer className="terminal-footer">
        <span>
          <i className="live-dot" /> bash · codex
        </span>
        <span>UTF-8 · LF</span>
        <span>workspace authoritative</span>
      </footer>
    </section>
  );
}

function RequestInspector() {
  const snapshot = useSessionStore((state) => state.snapshot);
  const lens = useSessionStore((state) => state.lens);
  const setLens = useSessionStore((state) => state.setLens);
  if (!snapshot) return <div className="panel loading">Connecting to session…</div>;
  const request = snapshot.request;

  return (
    <section
      className="panel request-panel"
      data-testid="pending-request"
      aria-label="Pending request"
    >
      <div className="panel-title">
        <span>
          <Radio size={15} /> INBOUND REQUEST
        </span>
        <small className="amber">AWAITING RESPONSE</small>
      </div>
      <div className="request-meta">
        <span>
          <small>MODEL</small>
          {request.model}
        </span>
        <span>
          <small>REQUEST ID</small>
          {request.requestId}
        </span>
        <span>
          <small>TOOLS</small>
          {request.tools.length}
        </span>
      </div>
      <div className="lens-tabs" role="tablist" aria-label="Request lenses">
        {(Object.keys(lensLabels) as Lens[]).map((item) => (
          <button
            type="button"
            key={item}
            role="tab"
            tabIndex={lens === item ? 0 : -1}
            aria-selected={lens === item}
            onKeyDown={moveTabFocus}
            onClick={() => setLens(item)}
          >
            {item === "raw" ? (
              <Code2 size={14} />
            ) : item === "contract" ? (
              <Braces size={14} />
            ) : (
              <FileCode2 size={14} />
            )}{" "}
            {lensLabels[item]}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {lens === "structured" && (
          <>
            <div className="instruction-card">
              <small>SYSTEM INSTRUCTIONS</small>
              <p>{request.instructions}</p>
            </div>
            <div className="message-card">
              <span className="role-label">USER</span>
              <p>{request.prompt}</p>
            </div>
          </>
        )}
        {lens === "raw" && <pre className="raw-code">{redactWireJson(request.raw)}</pre>}
        {lens === "contract" && (
          <div className="tool-list">
            {request.tools.map((tool) => (
              <article key={tool.name}>
                <Wrench size={16} />
                <div>
                  <b>{tool.name}</b>
                  <p>{tool.description}</p>
                  <pre>{JSON.stringify(tool.parameters, null, 2)}</pre>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ResponseComposer() {
  const snapshot = useSessionStore((state) => state.snapshot);
  const setDraft = useSessionStore((state) => state.setDraft);
  const submit = useSessionStore((state) => state.submit);
  const [isComposing, setIsComposing] = useState(false);
  const issues = useMemo(
    () => (snapshot ? validateDraft(snapshot.draft, snapshot.request) : []),
    [snapshot],
  );
  if (!snapshot) return <div className="panel loading">Preparing response controls…</div>;
  const draft = snapshot.draft;
  const isLocked = snapshot.requestState === "submitted" || snapshot.requestState === "waiting";

  const handleSubmit = () => {
    if (issues.length === 0 && snapshot.requestState !== "submitted") void submit();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key === "Enter" &&
      !isComposing &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      handleSubmit();
    }
  };
  const composing = (value: boolean) => (_event: CompositionEvent) => setIsComposing(value);

  return (
    <form
      className="panel composer-panel"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="panel-title">
        <span>
          <Sparkles size={15} /> RESPONSE COMPOSER
        </span>
        <small>ASSISTED MODE</small>
      </div>
      <div className="response-modes" role="tablist" aria-label="Response type">
        <button
          type="button"
          data-testid="response-mode-text"
          role="tab"
          tabIndex={draft.kind === "text" ? 0 : -1}
          aria-label="Text response"
          aria-selected={draft.kind === "text"}
          onKeyDown={moveTabFocus}
          disabled={isLocked}
          onClick={() => setDraft({ kind: "text", text: "" })}
        >
          <FileCode2 size={16} /> Text answer
        </button>
        <button
          type="button"
          data-testid="response-mode-tool"
          role="tab"
          tabIndex={draft.kind === "tool" ? 0 : -1}
          aria-label="Tool response"
          aria-selected={draft.kind === "tool"}
          onKeyDown={moveTabFocus}
          disabled={isLocked}
          onClick={() =>
            setDraft({
              kind: "tool",
              toolName: snapshot.request.tools[0]?.name ?? "",
              argumentsJson: "{}",
            })
          }
        >
          <Wrench size={16} /> Tool call
        </button>
      </div>
      <div className="composer-body">
        {draft.kind === "text" ? (
          <label className="field">
            <span>ASSISTANT OUTPUT</span>
            <textarea
              aria-label="Model response"
              disabled={isLocked}
              data-testid="response-text"
              value={draft.text}
              onCompositionStart={composing(true)}
              onCompositionEnd={composing(false)}
              onChange={(event) => setDraft({ kind: "text", text: event.target.value })}
              placeholder="Codex harnessへ返す意味的な出力…"
            />
          </label>
        ) : (
          <>
            <label className="field">
              <span>FUNCTION</span>
              <select
                aria-label="Tool"
                disabled={isLocked}
                data-testid="tool-select"
                value={draft.toolName}
                onChange={(event) => setDraft({ ...draft, toolName: event.target.value })}
              >
                {snapshot.request.tools.map((tool) => (
                  <option key={tool.name}>{tool.name}</option>
                ))}
              </select>
            </label>
            <div className="field editor-field">
              <span>
                ARGUMENTS <small>JSON object</small>
              </span>
              <div data-testid="tool-arguments">
                <Suspense fallback={<div className="editor-loading">Loading JSON editor…</div>}>
                  <JsonEditor
                    value={draft.argumentsJson}
                    disabled={isLocked}
                    onChange={(value) => setDraft({ ...draft, argumentsJson: value })}
                  />
                </Suspense>
              </div>
            </div>
          </>
        )}
        <div
          className={`validation ${issues.length ? "invalid" : "valid"}`}
          data-testid="validation-errors"
          aria-live="polite"
        >
          {issues.length ? (
            <>
              <AlertTriangle size={16} />
              <span>
                <b>Needs attention</b>
                {issues.map((issue) => (
                  <small key={issue.field}>{issue.message}</small>
                ))}
              </span>
            </>
          ) : (
            <>
              <ShieldCheck size={16} />
              <span>
                <b>Contract valid</b>
                <small>framingとIDはgatewayが補完します</small>
              </span>
            </>
          )}
        </div>
      </div>
      <div className="submit-row">
        <span>
          <kbd>Ctrl/⌘</kbd>
          <kbd>↵</kbd> to transmit
        </span>
        <button
          type="button"
          aria-label="Submit response"
          data-testid="response-submit"
          disabled={issues.length > 0 || snapshot.requestState === "submitted"}
          onClick={handleSubmit}
        >
          {snapshot.requestState === "submitted" ? (
            <>
              <Check size={17} /> TRANSMITTED
            </>
          ) : (
            <>
              <Send size={17} /> VALIDATE & TRANSMIT
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function FlightRecorder() {
  const snapshot = useSessionStore((state) => state.snapshot);
  if (!snapshot) return null;
  const isLedger = snapshot.emittedEvents.length > 0;
  const events = isLedger ? snapshot.emittedEvents : previewEvents(snapshot.draft);
  return (
    <aside
      className="flight-recorder"
      data-testid="activity-log"
      aria-label="Activity log"
      role="log"
    >
      <div className="recorder-title">
        <span>
          <Activity size={14} /> {isLedger ? "EMITTED LEDGER" : "WIRE PREVIEW"}
        </span>
        <small>
          {isLedger ? "IMMUTABLE" : "NOT TRANSMITTED"} · {events.length} EVENTS
        </small>
      </div>
      <ol>
        {events.map((event, index) => {
          const parsed = JSON.parse(event) as { type?: string };
          return (
            <li key={event}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <b>{parsed.type ?? "event"}</b>
                <small>{event}</small>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

export function Cockpit({ sessionId, seat, dual }: CockpitProps) {
  const reduceMotion = useReducedMotion();
  const [showRecorder, setShowRecorder] = useState(true);
  const error = useSessionStore((state) => state.error);
  const columns = dual ? "dual" : seat;
  useEffect(() => {
    document.title = `${seat === "model" ? "Human model" : "Harness"} · Codex Cockpit`;
  }, [seat]);
  return (
    <div className="cockpit-shell" data-testid="cockpit-shell">
      <Brand sessionId={sessionId} />
      <SeatNav sessionId={sessionId} seat={seat} />
      {error && (
        <div className="connection-error" role="alert">
          <AlertTriangle size={16} />
          <span>
            <b>Companion connection failed</b>
            {error}
          </span>
          <button type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      )}
      <main className={`workbench ${columns}`}>
        <AnimatePresence initial={false}>
          {(dual || seat === "terminal") && (
            <motion.div
              key="terminal"
              className="work-column"
              initial={reduceMotion ? false : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className="column-heading">
                <span>01</span>
                <div>
                  <small>HARNESS SIDE</small>
                  <h2>Operate the agent</h2>
                </div>
                <Users size={18} />
              </div>
              <TerminalPanel />
            </motion.div>
          )}
          {(dual || seat === "model") && (
            <motion.div
              key="model"
              className="work-column model-column"
              initial={reduceMotion ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
            >
              <div className="column-heading">
                <span>02</span>
                <div>
                  <small>MODEL SIDE</small>
                  <h2>Become the inference</h2>
                </div>
                <Gauge size={18} />
              </div>
              <RequestInspector />
              <ResponseComposer />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      {showRecorder && <FlightRecorder />}
      <button
        type="button"
        className="recorder-toggle"
        onClick={() => setShowRecorder((open) => !open)}
        aria-expanded={showRecorder}
      >
        <Activity size={14} />
        {showRecorder ? "Hide trace" : "Show trace"}
      </button>
      <button
        type="button"
        data-testid="solo-demo-start"
        className="sr-only"
        onClick={() => undefined}
      >
        Demo ready
      </button>
    </div>
  );
}
