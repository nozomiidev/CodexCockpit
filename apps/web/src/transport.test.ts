import { describe, expect, it } from "vitest";
import { createDemoTerminalLineEditor, DemoCockpitTransport } from "./transport";

// Keep the escape byte in a string so the test source itself has no control character.
// biome-ignore lint/complexity/useRegexLiterals: the ANSI escape is intentionally string-escaped.
const ansiPattern = new RegExp("\\u001b\\[[0-?]*[ -/]*[@-~]", "g");
const stripAnsi = (value: string) => value.replace(ansiPattern, "");

function lineEditorOutput() {
  const chunks: string[] = [];
  const editor = createDemoTerminalLineEditor((value) => chunks.push(value));
  return { chunks, editor, text: () => stripAnsi(chunks.join("")) };
}

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

describe("demo terminal line discipline", () => {
  it("edits a line with arrows, Backspace, Delete, Home, and End", () => {
    const output = lineEditorOutput();

    output.editor.write("abc");
    output.editor.write("\u001b[D");
    output.editor.write("\u007f");
    output.editor.write("\u001b[H");
    output.editor.write("x");
    output.editor.write("\u001b[C");
    output.editor.write("\u001b[3~");
    output.editor.write("\u001b[F!");
    output.editor.write("\r");

    expect(output.text()).toContain("$ xa!\r\n");
    expect(output.text()).toContain("xa!: command not found (demo)");
  });

  it("executes a submitted command and renders a fresh prompt", () => {
    const output = lineEditorOutput();

    output.editor.write("pwd");
    output.editor.write("\r");

    expect(output.text()).toContain("$ pwd\r\n/workspace/cockpit-lab\r\n$ ");
  });

  it("supports Ctrl-A/E/U/W/K, Ctrl-C, and command history", () => {
    const output = lineEditorOutput();

    output.editor.write("echo hello world");
    output.editor.write("\u0017");
    output.editor.write("\r");
    output.editor.write("echo discarded");
    output.editor.write("\u0001\u0005\u000b\u0005\u0015");
    output.editor.write("echo first\r");
    output.editor.write("echo second\r");
    output.editor.write("\u001b[A\r");
    output.editor.write("pwd\u0003");

    const text = output.text();
    expect(text).toContain("$ echo hello\r\nhello\r\n$ ");
    expect(text).toContain("$ echo second\r\nsecond\r\n$ ");
    expect(text).toContain("^C\r\n$ ");
  });

  it("accepts split arrow sequences and stops all output after dispose", () => {
    const output = lineEditorOutput();

    output.editor.write("ab");
    output.editor.write("\u001b");
    output.editor.write("[D");
    output.editor.write("x");
    const beforeDispose = output.chunks.length;
    output.editor.dispose();
    output.editor.write("\u001b[Cno-op\r");

    expect(output.text()).toContain("$ axb");
    expect(output.chunks).toHaveLength(beforeDispose);
  });
});
