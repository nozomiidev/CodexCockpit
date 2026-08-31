export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface RpcRequest {
  readonly id: number | string;
  readonly method: string;
  readonly params?: JsonValue;
}

export interface RpcNotification {
  readonly method: string;
  readonly params?: JsonValue;
}

export interface RpcResponse {
  readonly id: number | string;
  readonly result?: JsonValue;
  readonly error?: JsonObject;
}

export type AppServerMessage = RpcRequest | RpcNotification | RpcResponse;

export interface AppServerConnection {
  send(message: AppServerMessage): Promise<void>;
  messages(signal?: AbortSignal): AsyncIterable<AppServerMessage>;
  close(): Promise<void>;
}

export interface RpcPeer {
  request(method: string, params: JsonValue, options?: RpcRequestOptions): Promise<JsonValue>;
  notify(method: string, params?: JsonValue): Promise<void>;
  notifications(signal?: AbortSignal): AsyncIterable<RpcNotification>;
}

export interface RpcRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessProbe {
  run(executable: string, args: readonly string[], signal?: AbortSignal): Promise<ProcessResult>;
}

export interface CodexInstallation {
  readonly executable: string;
  readonly version: string;
}

export type AppServerTransport =
  | { readonly kind: "stdio" }
  | { readonly kind: "unix"; readonly socketPath: string };

export interface ChildProcessHandle {
  readonly connection?: AppServerConnection;
  readonly exited: Promise<ProcessResult>;
  stop(signal?: AbortSignal): Promise<void>;
}

export interface AppServerSpawner {
  spawn(specification: AppServerSpawnSpecification): Promise<ChildProcessHandle>;
}

export interface AppServerSpawnSpecification {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly transport: AppServerTransport;
}
