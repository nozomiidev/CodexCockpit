import { startAppServer } from "./app-server.js";
import { CommandExecBackend, type CommandExecSession } from "./command-exec.js";
import { CodexRuntimeError, type RuntimeErrorCode } from "./errors.js";
import { initializeAppServer } from "./initialization.js";
import { preflightRuntime, type RuntimePreflightReport } from "./preflight.js";
import { createSessionCodexHome } from "./session-home.js";
import type {
  AppServerConnection,
  AppServerSpawner,
  AppServerTransport,
  ChildProcessHandle,
  ProcessProbe,
  RpcPeer,
} from "./types.js";

export const PINNED_CODEX_VERSION = "0.151.0";

export interface RpcPeerFactory {
  connect(connection: AppServerConnection): Promise<RpcPeer>;
}

export interface CreateCodexSessionRequest {
  readonly sessionId: string;
  readonly sessionRoot: string;
  readonly workspacePath: string;
  readonly gatewayBaseUrl: string;
  readonly model: string;
  readonly clientVersion: string;
  readonly executable?: string;
  readonly expectedCodexVersion?: string;
  readonly gatewayBearerEnvKey?: string;
  readonly transport?: AppServerTransport;
  readonly signal?: AbortSignal;
}

export type CodexSessionCreationResult =
  | {
      readonly status: "ready";
      readonly runtime: CodexSessionRuntime;
      readonly preflight: RuntimePreflightReport;
    }
  | {
      readonly status: "unavailable";
      readonly reason: RuntimeUnavailableReason;
      readonly preflight: RuntimePreflightReport;
    };

export interface RuntimeUnavailableReason {
  readonly code: RuntimeErrorCode;
  readonly message: string;
  readonly nextStep: string;
  readonly demoFallback: {
    readonly available: true;
    readonly usesOfficialCodex: false;
    readonly limitation: string;
  };
}

export interface OpenCodexTerminalRequest {
  readonly processId: string;
  readonly rows: number;
  readonly cols: number;
  readonly args?: readonly string[];
  readonly signal?: AbortSignal;
}

export class CodexSessionRuntime {
  readonly version: string;
  readonly codexHome: string;
  readonly #workspacePath: string;
  readonly #executable: string;
  readonly #commandExec: CommandExecBackend;
  readonly #appServer: ChildProcessHandle;
  #closed = false;

  constructor(options: {
    version: string;
    codexHome: string;
    workspacePath: string;
    executable: string;
    peer: RpcPeer;
    appServer: ChildProcessHandle;
  }) {
    this.version = options.version;
    this.codexHome = options.codexHome;
    this.#workspacePath = options.workspacePath;
    this.#executable = options.executable;
    this.#commandExec = new CommandExecBackend(options.peer);
    this.#appServer = options.appServer;
  }

  /** Launches the official discovered Codex executable in the session workspace PTY. */
  async openCodexTerminal(request: OpenCodexTerminalRequest): Promise<CommandExecSession> {
    if (this.#closed) {
      throw new CodexRuntimeError(
        "app_server_exited",
        "The Codex session runtime is already closed.",
      );
    }
    return await this.#commandExec.open({
      processId: request.processId,
      command: [this.#executable, ...(request.args ?? [])],
      cwd: this.#workspacePath,
      rows: request.rows,
      cols: request.cols,
      permissionProfile: ":workspace",
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  }

  output(signal?: AbortSignal) {
    return this.#commandExec.output(signal);
  }

  async close(signal?: AbortSignal): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#appServer.connection?.close();
    await this.#appServer.stop(signal);
  }
}

export class CodexSessionRuntimeFactory {
  readonly #probe: ProcessProbe;
  readonly #spawner: AppServerSpawner;
  readonly #peerFactory: RpcPeerFactory;

  constructor(probe: ProcessProbe, spawner: AppServerSpawner, peerFactory: RpcPeerFactory) {
    this.#probe = probe;
    this.#spawner = spawner;
    this.#peerFactory = peerFactory;
  }

  async create(request: CreateCodexSessionRequest): Promise<CodexSessionCreationResult> {
    const transport = request.transport ?? { kind: "stdio" };
    const preflight = await preflightRuntime(this.#probe, {
      transport,
      ...(request.executable === undefined ? {} : { configuredExecutable: request.executable }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      expectedVersion: request.expectedCodexVersion ?? PINNED_CODEX_VERSION,
    });
    const installation = preflight.installation;
    if (!preflight.ready || installation === undefined) {
      return unavailable(
        preflight,
        "codex_not_found",
        "The pinned official Codex CLI is unavailable or has an incompatible version for this session.",
        `Install Codex CLI ${request.expectedCodexVersion ?? PINNED_CODEX_VERSION} or configure its absolute executable path, then run preflight again.`,
      );
    }

    let appServer: ChildProcessHandle | undefined;
    try {
      const home = await createSessionCodexHome({
        rootDirectory: request.sessionRoot,
        model: request.model,
        gatewayBaseUrl: request.gatewayBaseUrl,
        sessionId: request.sessionId,
        ...(request.gatewayBearerEnvKey === undefined
          ? {}
          : { gatewayBearerEnvKey: request.gatewayBearerEnvKey }),
      });
      appServer = await startAppServer(this.#spawner, {
        installation,
        codexHome: home.path,
        workspacePath: request.workspacePath,
        transport,
      });
      if (appServer.connection === undefined) {
        throw new CodexRuntimeError(
          "unsupported_capability",
          "The selected app-server spawner did not expose a protocol connection.",
        );
      }
      const peer = await this.#peerFactory.connect(appServer.connection);
      await initializeAppServer(peer, {
        clientVersion: request.clientVersion,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      return {
        status: "ready",
        preflight,
        runtime: new CodexSessionRuntime({
          version: installation.version,
          codexHome: home.path,
          workspacePath: request.workspacePath,
          executable: installation.executable,
          peer,
          appServer,
        }),
      };
    } catch (error: unknown) {
      await cleanupFailedStart(appServer);
      const code = error instanceof CodexRuntimeError ? error.code : "app_server_not_ready";
      const isExecutableResolutionFailure = errorContains(
        error,
        "Codex executable path is not configured",
      );
      return unavailable(
        preflight,
        code,
        error instanceof Error
          ? error.message
          : "The official Codex app-server did not become ready.",
        isExecutableResolutionFailure
          ? "Run Codex on a host that exposes /proc/self/exe or configure the packaged executable path; fixture demo is the only available mode in this restricted runtime."
          : "Inspect the app-server diagnostic, verify the pinned version and session configuration, then retry.",
      );
    }
  }
}

function errorContains(error: unknown, fragment: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (current.message.includes(fragment)) return true;
    current = current.cause;
  }
  return false;
}

async function cleanupFailedStart(appServer?: ChildProcessHandle): Promise<void> {
  if (appServer === undefined) return;
  try {
    await appServer.connection?.close();
  } finally {
    await appServer.stop();
  }
}

function unavailable(
  preflight: RuntimePreflightReport,
  code: RuntimeErrorCode,
  message: string,
  nextStep: string,
): CodexSessionCreationResult {
  return {
    status: "unavailable",
    preflight,
    reason: {
      code,
      message,
      nextStep,
      demoFallback: {
        available: true,
        usesOfficialCodex: false,
        limitation:
          "Demo mode can replay fixtures for UI learning, but it does not execute Codex, inspect a real workspace, or prove app-server compatibility.",
      },
    },
  };
}
