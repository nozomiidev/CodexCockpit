import { CodexRuntimeError } from "./errors.js";
import type {
  AppServerSpawner,
  AppServerTransport,
  ChildProcessHandle,
  CodexInstallation,
} from "./types.js";

export interface StartAppServerOptions {
  readonly installation: CodexInstallation;
  readonly codexHome: string;
  readonly workspacePath: string;
  readonly transport?: AppServerTransport;
  readonly inheritedEnvironment?: Readonly<Record<string, string | undefined>>;
}

export async function startAppServer(
  spawner: AppServerSpawner,
  options: StartAppServerOptions,
): Promise<ChildProcessHandle> {
  const transport = options.transport ?? { kind: "stdio" };
  const args = ["app-server", "--listen", listenerFor(transport)];
  const environment = copyDefined(options.inheritedEnvironment ?? process.env);
  environment.CODEX_HOME = options.codexHome;

  return await spawner.spawn({
    executable: options.installation.executable,
    args,
    cwd: options.workspacePath,
    env: environment,
    transport,
  });
}

export function listenerFor(transport: AppServerTransport): string {
  if (transport.kind === "stdio") return "stdio://";
  if (transport.socketPath.length === 0 || !transport.socketPath.startsWith("/")) {
    throw new CodexRuntimeError(
      "unsupported_capability",
      "Unix app-server transport requires an absolute socket path.",
    );
  }
  return `unix://${transport.socketPath}`;
}

function copyDefined(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const target: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) target[key] = value;
  }
  return target;
}
