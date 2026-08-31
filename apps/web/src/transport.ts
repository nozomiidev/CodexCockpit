import {
  createProjectId,
  isInferenceClaimReceipt,
  isTerminalStatusEvent,
} from "@codex-cockpit/protocol";
import { type ModelRequest, previewEvents, type SessionSnapshot } from "./domain";

export interface TerminalConnection {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
}

type DemoTerminalOutput = (value: string) => void;

const DEMO_PROMPT = "$ ";
const DEMO_HISTORY_LIMIT = 50;
const DEMO_ESCAPE_ACTIONS: readonly [
  sequence: string,
  action: "left" | "right" | "home" | "end" | "delete" | "up" | "down",
][] = [
  ["\u001b[3~", "delete"],
  ["\u001b[1~", "home"],
  ["\u001b[4~", "end"],
  ["\u001b[7~", "home"],
  ["\u001b[8~", "end"],
  ["\u001b[D", "left"],
  ["\u001b[C", "right"],
  ["\u001b[H", "home"],
  ["\u001b[F", "end"],
  ["\u001bOH", "home"],
  ["\u001bOF", "end"],
  ["\u001b[A", "up"],
  ["\u001b[B", "down"],
];

const DEMO_ESCAPE_SEQUENCES = DEMO_ESCAPE_ACTIONS.map(([sequence]) => sequence);

/**
 * Small readline-compatible line discipline for the static lesson terminal.
 *
 * xterm.js deliberately forwards key sequences instead of editing input. The
 * native companion receives those sequences in a real shell, but the static
 * demo needs a bounded browser-side equivalent so keyboard practice still
 * feels like a terminal. This adapter only emits terminal bytes; it does not
 * participate in the Responses transport or mutate the workspace store.
 */
export function createDemoTerminalLineEditor(emit: DemoTerminalOutput): {
  write(data: string): void;
  dispose(): void;
} {
  let characters: string[] = [];
  let cursor = 0;
  let history: string[] = [];
  let historyIndex = -1;
  let pendingEscape = "";
  let disposed = false;

  const output = (value: string) => {
    if (!disposed) emit(value);
  };

  const redraw = () => {
    const distanceFromEnd = characters.length - cursor;
    output(
      `\r\u001b[2K${DEMO_PROMPT}${characters.join("")}${
        distanceFromEnd > 0 ? `\u001b[${distanceFromEnd}D` : ""
      }`,
    );
  };

  const resetLine = () => {
    characters = [];
    cursor = 0;
    historyIndex = -1;
  };

  const setLine = (value: string) => {
    characters = Array.from(value);
    cursor = characters.length;
  };

  const moveHistory = (direction: "up" | "down") => {
    if (history.length === 0) return;
    if (direction === "up") {
      historyIndex = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setLine(history[historyIndex] ?? "");
      redraw();
      return;
    }
    if (historyIndex < 0) return;
    if (historyIndex >= history.length - 1) {
      historyIndex = -1;
      setLine("");
    } else {
      historyIndex += 1;
      setLine(history[historyIndex] ?? "");
    }
    redraw();
  };

  const execute = (command: string): string => {
    const [name = "", ...argumentsList] = command.trim().split(/\s+/);
    switch (name) {
      case "":
        return "";
      case "pwd":
        return "/workspace/cockpit-lab\r\n";
      case "ls":
        return "AGENTS.md  README.md  package.json  scripts  src\r\n";
      case "echo":
        return `${argumentsList.join(" ")}\r\n`;
      case "cat": {
        const path = argumentsList[0];
        if (path === "README.md")
          return "# Cockpit Lab\r\n\r\nA browser-persistent workspace for the Codex harness lesson.\r\n";
        if (path === "package.json") return '{"name":"cockpit-lab"}\r\n';
        return `${path ?? "cat"}: No such file\r\n`;
      }
      case "clear":
        return "\u001b[2J\u001b[H";
      case "help":
        return "Available commands: pwd, ls, cat, echo, clear, help\r\n";
      case "codex":
        return "Codex Cockpit demo runtime (use companion mode for the native CLI)\r\n";
      case "npx":
        return "npx is available in companion mode; this static terminal is a lesson sandbox\r\n";
      default:
        return `${name}: command not found (demo)\r\n`;
    }
  };

  const submit = () => {
    const command = characters.join("");
    if (command && history.at(-1) !== command) {
      history = [...history, command].slice(-DEMO_HISTORY_LIMIT);
    }
    output("\r\n");
    output(execute(command));
    output(DEMO_PROMPT);
    resetLine();
  };

  const handleControl = (character: string): boolean => {
    switch (character) {
      case "\u0001": // Ctrl-A / beginning of line
        cursor = 0;
        redraw();
        return true;
      case "\u0005": // Ctrl-E / end of line
        cursor = characters.length;
        redraw();
        return true;
      case "\u000b": // Ctrl-K / kill to end
        characters = characters.slice(0, cursor);
        historyIndex = -1;
        redraw();
        return true;
      case "\u000c": // Ctrl-L / clear screen
        output("\u001b[2J\u001b[H");
        redraw();
        return true;
      case "\u0003": // Ctrl-C / cancel line
        output("^C\r\n");
        resetLine();
        output(DEMO_PROMPT);
        return true;
      case "\u0004": // Ctrl-D / delete at cursor (EOF on an empty shell line)
        if (cursor < characters.length) {
          characters.splice(cursor, 1);
          historyIndex = -1;
          redraw();
        }
        return true;
      case "\u0015": // Ctrl-U / kill to beginning
        characters = characters.slice(cursor);
        cursor = 0;
        historyIndex = -1;
        redraw();
        return true;
      case "\u0017": {
        // Ctrl-W / erase previous word
        const beforeCursor = characters
          .slice(0, cursor)
          .join("")
          .replace(/\s+\S*$/, "");
        characters = [...Array.from(beforeCursor), ...characters.slice(cursor)];
        cursor = Array.from(beforeCursor).length;
        historyIndex = -1;
        redraw();
        return true;
      }
      default:
        return false;
    }
  };

  const handleEscape = (input: string, offset: number): number | undefined => {
    const remaining = input.slice(offset);
    for (const [sequence, action] of DEMO_ESCAPE_ACTIONS) {
      if (!remaining.startsWith(sequence)) continue;
      switch (action) {
        case "left":
          cursor = Math.max(0, cursor - 1);
          redraw();
          break;
        case "right":
          cursor = Math.min(characters.length, cursor + 1);
          redraw();
          break;
        case "home":
          cursor = 0;
          redraw();
          break;
        case "end":
          cursor = characters.length;
          redraw();
          break;
        case "delete":
          if (cursor < characters.length) {
            characters.splice(cursor, 1);
            historyIndex = -1;
            redraw();
          }
          break;
        case "up":
        case "down":
          moveHistory(action);
          break;
      }
      return offset + sequence.length;
    }
    if (DEMO_ESCAPE_SEQUENCES.some((sequence) => sequence.startsWith(remaining))) return undefined;
    return offset + 1;
  };

  return {
    write(data) {
      if (disposed) return;
      const input = pendingEscape + data;
      pendingEscape = "";
      let index = 0;
      while (index < input.length) {
        if (input[index] === "\u001b") {
          const next = handleEscape(input, index);
          if (next === undefined) {
            pendingEscape = input.slice(index);
            break;
          }
          index = next;
          continue;
        }
        const character = input[index] ?? "";
        index += 1;
        if (character === "\r" || character === "\n") {
          submit();
          continue;
        }
        if (character === "\u007f" || character === "\b") {
          if (cursor > 0) {
            characters.splice(cursor - 1, 1);
            cursor -= 1;
            historyIndex = -1;
            redraw();
          }
          continue;
        }
        if (handleControl(character)) continue;
        if (character >= " " && character !== "\u007f") {
          characters.splice(cursor, 0, character);
          cursor += 1;
          historyIndex = -1;
          redraw();
        }
      }
    },
    dispose() {
      disposed = true;
      characters = [];
      history = [];
      pendingEscape = "";
    },
  };
}
export interface CockpitTransport {
  connect(sessionId: string, signal: AbortSignal): Promise<SessionSnapshot>;
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void;
  update(snapshot: SessionSnapshot): void;
  submitPrompt(prompt: string, signal: AbortSignal): Promise<SessionSnapshot>;
  submit(snapshot: SessionSnapshot, signal: AbortSignal): Promise<SessionSnapshot>;
  openTerminal(
    onData: (data: Uint8Array) => void,
    onStatus: (status: string) => void,
  ): TerminalConnection;
  dispose(): void;
}

const demoTools = [
  {
    name: "shell",
    description: "Run a command in the authoritative workspace.",
    parameters: {
      type: "object",
      required: ["command"],
      properties: { command: { type: "string" } },
    },
  },
  {
    name: "apply_patch",
    description: "Apply a structured patch to workspace files.",
    parameters: { type: "object", required: ["patch"], properties: { patch: { type: "string" } } },
  },
] as const;

function createRequest(prompt: string, sequence: number): ModelRequest {
  const request = {
    requestId: `req_demo_${String(sequence).padStart(4, "0")}`,
    model: "gpt-5.5",
    instructions:
      "You are a coding agent. Inspect the workspace before editing and keep changes narrowly scoped.",
    prompt,
    tools: demoTools,
  };
  return {
    ...request,
    raw: JSON.stringify(
      {
        model: request.model,
        instructions: request.instructions,
        input: [{ role: "user", content: prompt }],
        tools: request.tools,
        stream: true,
      },
      null,
      2,
    ),
  };
}

abstract class BaseTransport {
  protected listeners = new Set<(snapshot: SessionSnapshot) => void>();
  protected snapshot: SessionSnapshot | undefined;
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  protected publish(snapshot: SessionSnapshot): void {
    for (const listener of this.listeners) listener(snapshot);
  }
}

export class DemoCockpitTransport extends BaseTransport implements CockpitTransport {
  private channel: BroadcastChannel | undefined;
  private storageKey: string | undefined;
  private readonly storageListener = (event: StorageEvent) => {
    if (event.key === this.storageKey && event.newValue) {
      const snapshot = parseSnapshot(event.newValue);
      if (snapshot) this.receive(snapshot);
    }
  };

  async connect(sessionId: string, signal: AbortSignal): Promise<SessionSnapshot> {
    if (signal.aborted) throw new DOMException("Connection cancelled", "AbortError");
    this.storageKey = `codex-cockpit:demo:${sessionId}`;
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(`codex-cockpit:${sessionId}`);
      this.channel.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (isSnapshot(event.data)) this.receive(event.data);
      });
    }
    window.addEventListener("storage", this.storageListener);
    const restored = parseSnapshot(localStorage.getItem(this.storageKey) ?? "");
    const request = createRequest(
      "READMEの未完了タスクを確認して、最初の一つを実装してください。",
      1,
    );
    this.snapshot = restored ?? {
      sessionId,
      connection: "connected",
      requestState: "drafting",
      request,
      draft: {
        kind: "tool",
        toolName: "shell",
        argumentsJson: '{\n  "command": "sed -n \'1,200p\' README.md"\n}',
      },
      sequence: 1,
      emittedEvents: [],
    };
    queueMicrotask(() => this.snapshot && this.publish(this.snapshot));
    return this.snapshot;
  }
  update(snapshot: SessionSnapshot): void {
    if (this.snapshot?.requestState !== "submitted")
      this.broadcast({ ...snapshot, sequence: snapshot.sequence + 1 });
  }
  async submitPrompt(prompt: string, signal: AbortSignal): Promise<SessionSnapshot> {
    if (signal.aborted) throw new DOMException("Prompt cancelled", "AbortError");
    if (!this.snapshot) throw new Error("Session is not connected");
    const sequence = this.snapshot.sequence + 1;
    const updated: SessionSnapshot = {
      ...this.snapshot,
      request: createRequest(prompt, sequence),
      draft: { kind: "tool", toolName: "shell", argumentsJson: '{\n  "command": "pwd"\n}' },
      requestState: "drafting",
      sequence,
      emittedEvents: [],
    };
    this.broadcast(updated);
    return updated;
  }
  async submit(snapshot: SessionSnapshot, signal: AbortSignal): Promise<SessionSnapshot> {
    if (signal.aborted) throw new DOMException("Submission cancelled", "AbortError");
    if (this.snapshot?.requestState === "submitted") throw new Error("Response already submitted");
    const submitted = {
      ...snapshot,
      requestState: "submitted" as const,
      sequence: snapshot.sequence + 1,
      emittedEvents: previewEvents(snapshot.draft),
    };
    this.broadcast(submitted);
    return submitted;
  }
  openTerminal(
    onData: (data: Uint8Array) => void,
    onStatus: (status: string) => void,
  ): TerminalConnection {
    const encoder = new TextEncoder();
    const lineEditor = createDemoTerminalLineEditor((value) => onData(encoder.encode(value)));
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      onStatus("demo");
      onData(encoder.encode("Codex Cockpit demo terminal\r\n"));
      onData(encoder.encode(DEMO_PROMPT));
    });
    return {
      write(data) {
        lineEditor.write(data);
      },
      resize() {},
      dispose() {
        disposed = true;
        lineEditor.dispose();
      },
    };
  }
  dispose(): void {
    window.removeEventListener("storage", this.storageListener);
    this.channel?.close();
    this.channel = undefined;
    this.listeners.clear();
    this.snapshot = undefined;
  }
  private receive(snapshot: SessionSnapshot): void {
    if (this.snapshot && snapshot.sequence <= this.snapshot.sequence) return;
    this.snapshot = snapshot;
    this.publish(snapshot);
  }
  private broadcast(snapshot: SessionSnapshot): void {
    this.snapshot = snapshot;
    this.publish(snapshot);
    this.channel?.postMessage(snapshot);
    if (this.storageKey) localStorage.setItem(this.storageKey, JSON.stringify(snapshot));
  }
}

export class CompanionCockpitTransport extends BaseTransport implements CockpitTransport {
  private sessionId = "";
  private pollTimer: number | undefined;
  private pollController: AbortController | undefined;
  private disposed = false;
  private terminalSocket: WebSocket | undefined;
  private readonly playerId = createProjectId("ply", {
    nowMs: Date.now(),
    randomBytes: crypto.getRandomValues(new Uint8Array(10)),
  });
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {
    super();
  }
  async connect(sessionId: string, signal: AbortSignal): Promise<SessionSnapshot> {
    this.disposed = false;
    this.sessionId = sessionId;
    const snapshot = await this.fetchPending(signal);
    this.snapshot = snapshot;
    this.schedulePoll();
    return snapshot;
  }
  update(snapshot: SessionSnapshot): void {
    if (snapshot.requestState !== "submitted") {
      this.snapshot = snapshot;
      this.publish(snapshot);
    }
  }
  async submitPrompt(prompt: string, signal: AbortSignal): Promise<SessionSnapshot> {
    if (signal.aborted) throw new DOMException("Prompt cancelled", "AbortError");
    if (!this.snapshot) throw new Error("Session is not connected");
    const response = await fetch(
      `${this.baseUrl}/sessions/${encodeURIComponent(this.sessionId)}/exercises`,
      { method: "POST", signal, headers: this.headers(), body: JSON.stringify({ prompt }) },
    );
    if (!response.ok) throw new Error(`Companion exercise failed (${response.status})`);
    const request = pendingItemToRequest(await response.json());
    if (!request) throw new Error("Companion returned an invalid exercise");
    const updated: SessionSnapshot = {
      ...this.snapshot,
      request,
      requestState: "drafting",
      draft: { kind: "text", text: "" },
      sequence: this.snapshot.sequence + 1,
      emittedEvents: [],
    };
    this.snapshot = updated;
    this.publish(updated);
    return updated;
  }
  async submit(snapshot: SessionSnapshot, signal: AbortSignal): Promise<SessionSnapshot> {
    if (snapshot.requestState === "submitted") throw new Error("Response already submitted");
    const claim = await fetch(
      `${this.baseUrl}/sessions/${encodeURIComponent(this.sessionId)}/pending/${encodeURIComponent(snapshot.request.requestId)}/claim`,
      {
        method: "POST",
        signal,
        headers: this.headers(),
        body: JSON.stringify({ playerId: this.playerId }),
      },
    );
    if (!claim.ok) throw new Error(`Companion claim failed (${claim.status})`);
    const receipt: unknown = await claim.json();
    if (!isInferenceClaimReceipt(receipt))
      throw new Error("Companion returned an invalid claim receipt");
    if (
      receipt.sessionId !== this.sessionId ||
      receipt.inferenceId !== snapshot.request.requestId ||
      receipt.playerId !== this.playerId
    )
      throw new Error("Claim receipt does not match this session request");
    const response = await fetch(
      `${this.baseUrl}/sessions/${encodeURIComponent(this.sessionId)}/pending/${encodeURIComponent(snapshot.request.requestId)}/commit`,
      {
        method: "POST",
        signal,
        headers: this.headers(),
        body: JSON.stringify({
          playerId: this.playerId,
          claimId: receipt.claimId,
          expectedRevision: receipt.revision,
          response: snapshot.draft,
        }),
      },
    );
    if (!response.ok) throw new Error(`Companion commit failed (${response.status})`);
    if (this.pollTimer !== undefined) window.clearTimeout(this.pollTimer);
    const submitted = {
      ...snapshot,
      requestState: "submitted" as const,
      sequence: snapshot.sequence + 1,
      emittedEvents: previewEvents(snapshot.draft),
    };
    this.snapshot = submitted;
    this.publish(submitted);
    return submitted;
  }
  openTerminal(
    onData: (data: Uint8Array) => void,
    onStatus: (status: string) => void,
  ): TerminalConnection {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/sessions/${encodeURIComponent(this.sessionId)}/terminal`;
    let socket: WebSocket | undefined;
    void fetch(`${this.baseUrl}/sessions/${encodeURIComponent(this.sessionId)}/terminal-ticket`, {
      method: "POST",
      headers: this.headers(),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Terminal ticket failed (${response.status})`);
        const value: unknown = await response.json();
        if (
          typeof value !== "object" ||
          value === null ||
          !("ticket" in value) ||
          typeof value.ticket !== "string"
        )
          throw new Error("Invalid terminal ticket");
        socket = new WebSocket(url, ["codex-cockpit", value.ticket]);
        this.terminalSocket = socket;
        socket.binaryType = "arraybuffer";
        socket.addEventListener("open", () => onStatus("connected"));
        socket.addEventListener("close", () => onStatus("closed"));
        socket.addEventListener("error", () => onStatus("error"));
        socket.addEventListener("message", (event) => {
          if (event.data instanceof ArrayBuffer) onData(new Uint8Array(event.data));
          else if (typeof event.data === "string") {
            try {
              const status: unknown = JSON.parse(event.data);
              onStatus(isTerminalStatusEvent(status) ? status.state : "invalid terminal status");
            } catch {
              onStatus("invalid terminal status");
            }
          }
        });
      })
      .catch((error: unknown) =>
        onStatus(error instanceof Error ? error.message : "terminal setup failed"),
      );
    const owner = this;
    return {
      write(data) {
        if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
      },
      resize(cols, rows) {
        if (socket?.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ schemaVersion: 1, type: "terminal.resize", cols, rows }));
      },
      dispose() {
        if (socket && socket.readyState < WebSocket.CLOSING) {
          socket.send(JSON.stringify({ schemaVersion: 1, type: "terminal.close" }));
          socket.close();
          if (owner.terminalSocket === socket) owner.terminalSocket = undefined;
        }
      },
    };
  }
  dispose(): void {
    this.disposed = true;
    if (this.pollTimer !== undefined) window.clearTimeout(this.pollTimer);
    this.pollController?.abort();
    this.terminalSocket?.close();
    this.terminalSocket = undefined;
    this.listeners.clear();
  }
  private headers(): HeadersInit {
    return { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" };
  }
  private schedulePoll(): void {
    if (this.disposed) return;
    this.pollTimer = window.setTimeout(() => {
      const controller = new AbortController();
      this.pollController = controller;
      void this.fetchPending(controller.signal)
        .then((snapshot) => {
          this.snapshot = snapshot;
          this.publish(snapshot);
        })
        .catch(() => {
          if (this.snapshot) {
            this.snapshot = { ...this.snapshot, connection: "reconnecting" };
            this.publish(this.snapshot);
          }
        })
        .finally(() => {
          this.pollController = undefined;
          this.schedulePoll();
        });
    }, 750);
  }
  private async fetchPending(signal: AbortSignal): Promise<SessionSnapshot> {
    const response = await fetch(
      `${this.baseUrl}/sessions/${encodeURIComponent(this.sessionId)}/pending`,
      { signal, headers: this.headers() },
    );
    if (!response.ok) throw new Error(`Companion pending request failed (${response.status})`);
    const value: unknown = await response.json();
    const request =
      pendingToRequest(value) ?? createRequest("Waiting for Codex to send a model request…", 0);
    return {
      sessionId: this.sessionId,
      connection: "connected",
      requestState: request.requestId === "req_demo_0000" ? "waiting" : "drafting",
      request,
      draft: { kind: "text", text: "" },
      sequence: (this.snapshot?.sequence ?? 0) + 1,
      emittedEvents: [],
    };
  }
}

export function createCockpitTransport(search: URLSearchParams): CockpitTransport {
  const configuredTransport =
    search.get("transport") ?? import.meta.env.VITE_CODEX_COCKPIT_TRANSPORT;
  return configuredTransport === "companion"
    ? new CompanionCockpitTransport(
        search.get("companionUrl") ??
          import.meta.env.VITE_CODEX_COCKPIT_COMPANION_URL ??
          "http://127.0.0.1:4317",
        search.get("token") ?? "",
      )
    : new DemoCockpitTransport();
}
function pendingToRequest(value: unknown): ModelRequest | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("items" in value) ||
    !Array.isArray(value.items) ||
    value.items.length === 0
  )
    return undefined;
  return pendingItemToRequest(value.items[0]);
}
function pendingItemToRequest(item: unknown): ModelRequest | undefined {
  if (
    typeof item !== "object" ||
    item === null ||
    !("request" in item) ||
    typeof item.request !== "object" ||
    item.request === null
  )
    return undefined;
  const request = item.request as Record<string, unknown>;
  const requestId = "id" in item && typeof item.id === "string" ? item.id : "pending";
  return {
    requestId,
    model: typeof request.model === "string" ? request.model : "unknown",
    instructions: typeof request.instructions === "string" ? request.instructions : "",
    prompt: extractPrompt(request),
    tools: extractTools(request.tools),
    raw: JSON.stringify(request, null, 2),
  };
}
function extractTools(value: unknown): ModelRequest["tools"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tool) => {
    if (
      typeof tool !== "object" ||
      tool === null ||
      !("name" in tool) ||
      typeof tool.name !== "string"
    )
      return [];
    const record = tool as Record<string, unknown>;
    return [
      {
        name: tool.name,
        description: typeof record.description === "string" ? record.description : "",
        parameters:
          typeof record.parameters === "object" && record.parameters !== null
            ? (record.parameters as Record<string, unknown>)
            : {},
      },
    ];
  });
}
function extractPrompt(record: Record<string, unknown>): string {
  if (typeof record.prompt === "string") return record.prompt;
  if (Array.isArray(record.input))
    return record.input
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join("\n");
  return "Pending model request";
}
function parseSnapshot(value: string): SessionSnapshot | undefined {
  if (!value) return undefined;
  try {
    const candidate: unknown = JSON.parse(value);
    return isSnapshot(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}
function isSnapshot(value: unknown): value is SessionSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    "sequence" in value &&
    typeof value.sequence === "number" &&
    "request" in value &&
    typeof value.request === "object" &&
    value.request !== null &&
    "draft" in value &&
    typeof value.draft === "object" &&
    value.draft !== null &&
    "emittedEvents" in value &&
    Array.isArray(value.emittedEvents)
  );
}
