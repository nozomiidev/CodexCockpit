import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SessionCodexHomeOptions {
  readonly rootDirectory: string;
  readonly model: string;
  readonly gatewayBaseUrl: string;
  readonly streamIdleTimeoutMs?: number;
  readonly sessionId?: string;
  readonly gatewayBearerEnvKey?: string;
}

export interface SessionCodexHome {
  readonly path: string;
  readonly configPath: string;
}

export async function createSessionCodexHome(
  options: SessionCodexHomeOptions,
): Promise<SessionCodexHome> {
  const path = join(options.rootDirectory, "codex-home");
  const configPath = join(path, "config.toml");
  await mkdir(path, { recursive: true, mode: 0o700 });
  await writeFile(configPath, renderConfig(options), { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { path, configPath };
}

export function renderConfig(options: SessionCodexHomeOptions): string {
  return [
    `model = ${tomlString(options.model)}`,
    'model_provider = "cockpit"',
    "",
    "[model_providers.cockpit]",
    'name = "CodexCockpit Human Model"',
    `base_url = ${tomlString(options.gatewayBaseUrl)}`,
    'wire_api = "responses"',
    "request_max_retries = 0",
    "stream_max_retries = 0",
    `stream_idle_timeout_ms = ${String(options.streamIdleTimeoutMs ?? 1_800_000)}`,
    ...(options.gatewayBearerEnvKey === undefined
      ? []
      : [`env_key = ${tomlString(options.gatewayBearerEnvKey)}`]),
    ...(options.sessionId === undefined
      ? []
      : [`http_headers = { "x-codex-cockpit-session-id" = ${tomlString(options.sessionId)} }`]),
    "",
  ].join("\n");
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
