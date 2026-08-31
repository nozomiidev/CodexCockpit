import { spawn } from "node:child_process";
import { CodexRuntimeError } from "./errors.js";
import type { ProcessProbe, ProcessResult } from "./types.js";

export class NodeProcessProbe implements ProcessProbe {
  async run(
    executable: string,
    args: readonly string[],
    signal?: AbortSignal,
  ): Promise<ProcessResult> {
    const deadline = AbortSignal.timeout(5_000);
    const effectiveSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
    return await new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(executable, [...args], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        signal: effectiveSignal,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout = `${stdout}${chunk}`.slice(-64 * 1024);
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-64 * 1024);
      });
      child.once("error", (cause: Error) => {
        reject(
          new CodexRuntimeError(
            "codex_probe_failed",
            `Could not execute ${executable}.`,
            { executable },
            { cause },
          ),
        );
      });
      child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });
  }
}
