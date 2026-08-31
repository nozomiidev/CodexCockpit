import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { encodeCompletedResponse, encodeSse, writeWithBackpressure } from "../src/sse.js";

describe("SSE framing", () => {
  it("encodes one JSON event with an explicit blank-line boundary", () => {
    expect(encodeSse({ id: "rsp_1" }, "response.completed")).toBe(
      'event: response.completed\ndata: {"id":"rsp_1"}\n\n',
    );
  });

  it("builds monotonic Codex-compatible completed-item events", () => {
    const events = encodeCompletedResponse("rsp_1", {
      output: [
        {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello" }],
        },
      ],
    });
    expect(events).toHaveLength(3);
    expect(events[0]).toContain('"type":"response.output_text.delta"');
    expect(events[0]).toContain('"sequence_number":1');
    expect(events[1]).toContain('"type":"response.output_item.done"');
    expect(events[1]).toContain('"sequence_number":2');
    expect(events[2]).toContain('"type":"response.completed"');
    expect(events[2]).toContain('"sequence_number":3');
    expect(events[2]).toContain('"id":"rsp_1"');
  });

  it("waits for drain when the writable stream applies backpressure", async () => {
    const output = new EventEmitter() as EventEmitter & {
      destroyed: boolean;
      write: ReturnType<typeof vi.fn>;
    };
    output.destroyed = false;
    output.write = vi.fn(() => false);
    let settled = false;
    const writing = writeWithBackpressure(output as never, "chunk").then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    output.emit("drain");
    await writing;
    expect(settled).toBe(true);
  });

  it("rejects instead of hanging when a pressured stream closes", async () => {
    const output = new EventEmitter() as EventEmitter & {
      destroyed: boolean;
      write: ReturnType<typeof vi.fn>;
    };
    output.destroyed = false;
    output.write = vi.fn(() => false);
    const writing = writeWithBackpressure(output as never, "chunk");
    output.emit("close");
    await expect(writing).rejects.toThrow(/closed before drain/);
    expect(output.listenerCount("drain")).toBe(0);
    expect(output.listenerCount("error")).toBe(0);
  });
});
