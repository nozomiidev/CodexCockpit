import { fileURLToPath } from "node:url";
import { createCompanion } from "./app.js";
import { shutdownCompanion } from "./shutdown.js";

const token = process.env["CODEX_COCKPIT_TOKEN"];
if (token === undefined || token.length < 16)
  throw new Error("CODEX_COCKPIT_TOKEN must contain at least 16 characters");
const port = Number.parseInt(process.env["CODEX_COCKPIT_PORT"] ?? "4317", 10);
const host = process.env["CODEX_COCKPIT_HOST"] ?? "127.0.0.1";
const origins = (process.env["CODEX_COCKPIT_ALLOWED_ORIGINS"] ?? "http://localhost:5173")
  .split(",")
  .filter(Boolean);

const app = createCompanion({
  token,
  allowedOrigins: origins,
  ...(process.env["CODEX_COCKPIT_WORKSPACE_ROOT"] === undefined
    ? {}
    : { workspaceRoot: process.env["CODEX_COCKPIT_WORKSPACE_ROOT"] }),
  codexBinDirectory: fileURLToPath(new URL("../../../node_modules/.bin/", import.meta.url)),
});
const phases = ["configuration", "routes", "listen"] as const;
for (const [index, phase] of phases.entries())
  app.log.info({ phase, completed: index, total: phases.length }, "startup phase");
await app.listen({ host, port });
app.log.info({ phase: "ready", address: app.server.address() }, "companion ready");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ phase: "shutdown", signal }, "companion shutdown started");
    void shutdownCompanion(app, 5_000)
      .then((result) => {
        app.log.info({ phase: "shutdown", result }, "companion shutdown finished");
        if (result === "forced") process.exitCode = 1;
      })
      .catch((error: unknown) => {
        app.log.error({ err: error, phase: "shutdown" }, "companion shutdown failed");
        process.exitCode = 1;
      });
  });
}
