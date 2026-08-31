import { describe, expect, it } from "vitest";
import { DemoCockpitTransport } from "./transport";

describe("demo cockpit transport", () => {
  it("turns a left-seat prompt into the authoritative pending request", async () => {
    const transport = new DemoCockpitTransport();
    const controller = new AbortController();
    await transport.connect("prompt-loop", controller.signal);
    const next = await transport.submitPrompt("unique cockpit prompt", controller.signal);
    expect(next.request.prompt).toBe("unique cockpit prompt");
    expect(next.emittedEvents).toEqual([]);
    transport.dispose();
  });

  it("commits an immutable ledger once and rejects a second commit", async () => {
    const transport = new DemoCockpitTransport();
    const controller = new AbortController();
    const snapshot = await transport.connect("single-commit", controller.signal);
    const submitted = await transport.submit(snapshot, controller.signal);
    expect(submitted.emittedEvents.at(-1)).toContain("response.completed");
    await expect(transport.submit(submitted, controller.signal)).rejects.toThrow(
      "already submitted",
    );
    transport.dispose();
  });
});
