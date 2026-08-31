import { type DiscoverCodexOptions, discoverCodex } from "./discovery.js";
import type { AppServerTransport, CodexInstallation, ProcessProbe } from "./types.js";

export interface RuntimePreflightRequest extends DiscoverCodexOptions {
  readonly transport: AppServerTransport;
  readonly platform?: NodeJS.Platform;
  readonly requireExperimentalApi?: boolean;
  readonly expectedVersion?: string;
}

export interface RuntimePreflightReport {
  readonly ready: boolean;
  readonly installation?: CodexInstallation;
  readonly checks: readonly PreflightCheck[];
}

export interface PreflightCheck {
  readonly id: "codex_executable" | "codex_version" | "transport" | "experimental_api";
  readonly status: "pass" | "fail" | "warning";
  readonly message: string;
}

export async function preflightRuntime(
  probe: ProcessProbe,
  request: RuntimePreflightRequest,
): Promise<RuntimePreflightReport> {
  const checks: PreflightCheck[] = [];
  let installation: CodexInstallation | undefined;
  try {
    installation = await discoverCodex(probe, request);
    checks.push({
      id: "codex_executable",
      status: "pass",
      message: `Codex ${installation.version} found.`,
    });
  } catch (error: unknown) {
    checks.push({
      id: "codex_executable",
      status: "fail",
      message: error instanceof Error ? error.message : "Codex discovery failed.",
    });
  }
  if (installation !== undefined && request.expectedVersion !== undefined) {
    const matches = installation.version === request.expectedVersion;
    checks.push({
      id: "codex_version",
      status: matches ? "pass" : "fail",
      message: matches
        ? `Codex version matches the ${request.expectedVersion} pin.`
        : `Codex ${installation.version} does not match the required ${request.expectedVersion} pin.`,
    });
  }

  const platform = request.platform ?? process.platform;
  if (request.transport.kind === "unix" && platform === "win32") {
    checks.push({
      id: "transport",
      status: "fail",
      message: "Unix sockets are unavailable on Windows.",
    });
  } else {
    checks.push({
      id: "transport",
      status: "pass",
      message: `${request.transport.kind} transport is supported.`,
    });
  }
  checks.push({
    id: "experimental_api",
    status: request.requireExperimentalApi === true ? "warning" : "pass",
    message:
      request.requireExperimentalApi === true
        ? "Experimental app-server APIs require explicit initialization opt-in and version fixtures."
        : "Only documented app-server APIs are required.",
  });
  return {
    ready: checks.every((check) => check.status !== "fail"),
    ...(installation === undefined ? {} : { installation }),
    checks,
  };
}
