import type { FastifyInstance } from "fastify";

export type ShutdownResult = "graceful" | "forced";

/** Starts graceful shutdown, then forcibly closes sockets at the bounded deadline. */
export async function shutdownCompanion(
  app: FastifyInstance,
  deadlineMs: number,
): Promise<ShutdownResult> {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100) {
    throw new RangeError("shutdown deadline must be an integer of at least 100ms");
  }
  let timer: NodeJS.Timeout | undefined;
  const closing = app.close().then((): ShutdownResult => "graceful");
  const deadline = new Promise<"forced">((resolve) => {
    timer = setTimeout(() => {
      app.server.closeAllConnections();
      resolve("forced");
    }, deadlineMs);
    timer.unref();
  });
  const result = await Promise.race([closing, deadline]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}
