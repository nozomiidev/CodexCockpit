import { CodexRuntimeError } from "./errors.js";
import type { JsonValue, RpcPeer } from "./types.js";

export interface InitializeOptions {
  readonly clientName?: string;
  readonly clientTitle?: string;
  readonly clientVersion: string;
  readonly experimentalApi?: boolean;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface InitializedAppServer {
  readonly initializeResult: JsonValue;
  readonly experimentalApi: boolean;
}

/** Performs the mandatory initialize request followed by initialized notification. */
export async function initializeAppServer(
  peer: RpcPeer,
  options: InitializeOptions,
): Promise<InitializedAppServer> {
  try {
    const result = await peer.request(
      "initialize",
      {
        clientInfo: {
          name: options.clientName ?? "codex_cockpit",
          title: options.clientTitle ?? "CodexCockpit",
          version: options.clientVersion,
        },
        capabilities: {
          experimentalApi: options.experimentalApi ?? false,
          requestAttestation: false,
        },
      },
      {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs: options.timeoutMs ?? 10_000,
      },
    );
    await peer.notify("initialized");
    return { initializeResult: result, experimentalApi: options.experimentalApi ?? false };
  } catch (cause: unknown) {
    throw new CodexRuntimeError(
      "app_server_not_ready",
      "Codex app-server initialization failed.",
      {},
      { cause },
    );
  }
}
