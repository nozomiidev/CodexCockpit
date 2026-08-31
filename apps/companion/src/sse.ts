import type { ServerResponse } from "node:http";

export function encodeSse(data: unknown, event?: string): string {
  const prefix = event === undefined ? "" : `event: ${event}\n`;
  return `${prefix}data: ${JSON.stringify(data)}\n\n`;
}

export function encodeCompletedResponse(
  responseId: string,
  response: Readonly<Record<string, unknown>>,
): readonly string[] {
  const output = Array.isArray(response["output"]) ? response["output"] : [];
  const events: string[] = [];
  let sequenceNumber = 1;
  for (const [outputIndex, item] of output.entries()) {
    if (isRecord(item) && item["type"] === "message" && Array.isArray(item["content"])) {
      for (const [contentIndex, content] of item["content"].entries()) {
        if (
          isRecord(content) &&
          content["type"] === "output_text" &&
          typeof content["text"] === "string"
        ) {
          events.push(
            encodeSse({
              type: "response.output_text.delta",
              sequence_number: sequenceNumber,
              item_id: item["id"],
              output_index: outputIndex,
              content_index: contentIndex,
              delta: content["text"],
            }),
          );
          sequenceNumber += 1;
        }
      }
    }
    events.push(
      encodeSse({
        type: "response.output_item.done",
        sequence_number: sequenceNumber,
        output_index: outputIndex,
        item,
      }),
    );
    sequenceNumber += 1;
  }
  events.push(
    encodeSse({
      type: "response.completed",
      sequence_number: sequenceNumber,
      response: { ...response, id: responseId, status: "completed" },
    }),
  );
  return events;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function writeWithBackpressure(
  response: ServerResponse,
  chunk: string,
): Promise<void> {
  if (response.destroyed) throw new Error("response stream is closed");
  if (!response.write(chunk)) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        response.off("drain", onDrain);
        response.off("close", onClose);
        response.off("error", onError);
      };
      const onDrain = (): void => {
        cleanup();
        resolve();
      };
      const onClose = (): void => {
        cleanup();
        reject(new Error("response stream closed before drain"));
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      response.once("drain", onDrain);
      response.once("close", onClose);
      response.once("error", onError);
    });
  }
}

export function startHeartbeat(response: ServerResponse, intervalMs: number): () => void {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 100) {
    throw new RangeError("heartbeat interval must be an integer of at least 100ms");
  }
  const timer = setInterval(() => {
    if (!response.destroyed && !response.writableNeedDrain) {
      response.write(`: heartbeat ${Date.now()}\n\n`);
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
