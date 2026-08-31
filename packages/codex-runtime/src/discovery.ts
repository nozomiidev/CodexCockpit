import { isAbsolute, resolve } from "node:path";
import { CodexRuntimeError } from "./errors.js";
import type { CodexInstallation, ProcessProbe } from "./types.js";

const VERSION_PATTERN = /(?:codex-cli\s+)?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

export interface DiscoverCodexOptions {
  readonly configuredExecutable?: string;
  readonly candidates?: readonly string[];
  readonly signal?: AbortSignal;
}

export async function discoverCodex(
  probe: ProcessProbe,
  options: DiscoverCodexOptions = {},
): Promise<CodexInstallation> {
  const candidates = unique([
    ...(options.configuredExecutable === undefined
      ? []
      : [normalizeConfiguredExecutable(options.configuredExecutable)]),
    ...(options.candidates ?? ["codex"]),
  ]);
  const failures: string[] = [];

  for (const executable of candidates) {
    try {
      const result = await probe.run(executable, ["--version"], options.signal);
      if (result.exitCode !== 0) {
        failures.push(`${executable}: exited ${String(result.exitCode)}`);
        continue;
      }
      const match = VERSION_PATTERN.exec(`${result.stdout}\n${result.stderr}`);
      const version = match?.[1];
      if (version === undefined) {
        failures.push(`${executable}: version was not recognized`);
        continue;
      }
      return { executable, version };
    } catch (error: unknown) {
      failures.push(`${executable}: ${error instanceof Error ? error.message : "probe failed"}`);
    }
  }

  throw new CodexRuntimeError(
    "codex_not_found",
    "The official Codex executable was not found. Install Codex CLI or configure its executable path.",
    { candidates: candidates.join(", "), failures: failures.join("; ") },
  );
}

function normalizeConfiguredExecutable(executable: string): string {
  if (isAbsolute(executable) || (!executable.includes("/") && !executable.includes("\\"))) {
    return executable;
  }
  return resolve(executable);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
