import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_FILES,
  openWorkspaceStore,
  validateWorkspacePath,
  WorkspaceLimitError,
  WorkspacePathError,
} from "./workspace-store";

describe("workspace store", () => {
  it("seeds and deterministically lists files and implicit directories", async () => {
    const store = await openWorkspaceStore({ sessionId: "workspace-list-test" });
    expect(store.persistence).toBe("memory");
    expect(await store.read("README.md")).toContain("Cockpit Lab");
    expect(await store.list()).toEqual([
      { path: "AGENTS.md", kind: "file", size: expect.any(Number) },
      { path: "README.md", kind: "file", size: expect.any(Number) },
      { path: "package.json", kind: "file", size: expect.any(Number) },
      { path: "scripts", kind: "directory", size: 0 },
      { path: "scripts/check.sh", kind: "file", size: expect.any(Number) },
      { path: "src", kind: "directory", size: 0 },
      { path: "src/index.ts", kind: "file", size: expect.any(Number) },
    ]);
  });

  it("writes, reads, removes, and retains data in the memory fallback", async () => {
    const first = await openWorkspaceStore({ sessionId: "workspace-memory-test" });
    await first.write("notes/lesson.md", "# First turn\n");
    first.close();

    const second = await openWorkspaceStore({ sessionId: "workspace-memory-test" });
    expect(await second.read("notes/lesson.md")).toBe("# First turn\n");
    expect(await second.remove("notes/lesson.md")).toBe(true);
    expect(await second.remove("notes/lesson.md")).toBe(false);
    expect(await second.read("notes/lesson.md")).toBeUndefined();
  });

  it("resets a session to its configured educational seed", async () => {
    const seed = [{ path: "lesson.txt", content: "seed" }] as const;
    const store = await openWorkspaceStore({ sessionId: "workspace-reset-test", seedFiles: seed });
    await store.write("lesson.txt", "edited");
    await store.write("extra.txt", "extra");
    await store.reset();
    expect(await store.read("lesson.txt")).toBe("seed");
    expect(await store.read("extra.txt")).toBeUndefined();
  });

  it("rejects traversal, host paths, and ambiguous separators", () => {
    expect(() => validateWorkspacePath("../secret")).toThrow(WorkspacePathError);
    expect(() => validateWorkspacePath("/etc/passwd")).toThrow(WorkspacePathError);
    expect(() => validateWorkspacePath("src\\index.ts")).toThrow(WorkspacePathError);
    expect(() => validateWorkspacePath("src//index.ts")).toThrow(WorkspacePathError);
    expect(validateWorkspacePath("日本語/ノート.md")).toBe("日本語/ノート.md");
  });

  it("enforces file count, per-file, and total byte limits", async () => {
    const store = await openWorkspaceStore({
      sessionId: "workspace-limit-test",
      seedFiles: [],
      maxFiles: 1,
      maxFileBytes: 4,
      maxTotalBytes: 4,
    });
    await store.write("a.txt", "1234");
    await expect(store.write("a.txt", "12345")).rejects.toBeInstanceOf(WorkspaceLimitError);
    await expect(store.write("b.txt", "1")).rejects.toBeInstanceOf(WorkspaceLimitError);
  });

  it("accepts explicit seeds without mutating the exported defaults", async () => {
    const customSeed = [{ path: "README.md", content: "custom" }] as const;
    const store = await openWorkspaceStore({
      sessionId: "workspace-custom-seed-test",
      seedFiles: customSeed,
    });
    expect(await store.read("README.md")).toBe("custom");
    expect(DEFAULT_WORKSPACE_FILES.some((file) => file.content === "custom")).toBe(false);
  });
});
