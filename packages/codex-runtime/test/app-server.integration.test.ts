import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const pinnedVersion = "0.151.0";
const configuredExecutable = process.env.CODEX_COCKPIT_CODEX_EXECUTABLE;
const executable = configuredExecutable === undefined ? undefined : resolve(configuredExecutable);
const temporaryDirectories: string[] = [];
const integrationTest = executable === undefined ? it.skip : it;

if (executable === undefined) {
  console.warn(
    "Skipping pinned Codex app-server integration: set CODEX_COCKPIT_CODEX_EXECUTABLE " +
      `to the executable from @openai/codex@${pinnedVersion}.`,
  );
}

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("pinned official Codex app-server", () => {
  integrationTest(
    "generates matching contracts and completes the stdio handshake",
    async (context) => {
      if (executable === undefined) return;
      const root = await mkdtemp(join(process.cwd(), ".codex-runtime-smoke-"));
      temporaryDirectories.push(root);
      const home = join(root, "home");
      const types = join(root, "types");
      const schemas = join(root, "schemas");
      await mkdir(home, { recursive: true });

      const version = await run(executable, ["--version"], root);
      expect(version.stdout).toContain(`codex-cli ${pinnedVersion}`);
      expect(
        (
          await run(
            executable,
            ["app-server", "generate-ts", "--experimental", "--out", types],
            root,
          )
        ).code,
      ).toBe(0);
      expect(
        (
          await run(
            executable,
            ["app-server", "generate-json-schema", "--experimental", "--out", schemas],
            root,
          )
        ).code,
      ).toBe(0);

      const initializeCapabilities = await readFile(
        join(types, "InitializeCapabilities.ts"),
        "utf8",
      );
      const commandParams = await readFile(join(types, "v2", "CommandExecParams.ts"), "utf8");
      const outputNotification = await readFile(
        join(types, "v2", "CommandExecOutputDeltaNotification.ts"),
        "utf8",
      );
      expect(initializeCapabilities).toContain("requestAttestation: boolean");
      expect(commandParams).toContain("processId?: string | null");
      expect(commandParams).toContain("permissionProfile?: string | null");
      expect(outputNotification).toContain("deltaBase64: string");

      const handshake = await run(
        executable,
        ["app-server", "--listen", "stdio://"],
        root,
        [
          JSON.stringify({
            method: "initialize",
            id: 1,
            params: {
              clientInfo: {
                name: "codex_cockpit_smoke",
                title: "CodexCockpit Smoke",
                version: "0.0.0",
              },
              capabilities: { experimentalApi: false, requestAttestation: false },
            },
          }),
          JSON.stringify({ method: "initialized" }),
          "",
        ].join("\n"),
        {
          CODEX_HOME: home,
          PATH: `${dirname(executable)}${delimiter}${process.env.PATH ?? ""}`,
        },
      );
      if (handshake.stderr.includes("Codex executable path is not configured")) {
        console.warn(
          "Skipping stdio handshake: this sandbox hides /proc/self/exe, so Codex cannot create its argv0 helper aliases.",
        );
        context.skip();
      }
      expect(handshake.code, handshake.stderr).toBe(0);
      const response: unknown = JSON.parse(handshake.stdout.split("\n")[0] ?? "null");
      expect(response).toMatchObject({ id: 1, result: expect.any(Object) });
    },
    30_000,
  );
});

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  stdin?: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env: { ...process.env, ...environment },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 20_000);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-1024 * 1024);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-1024 * 1024);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(deadline);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}
