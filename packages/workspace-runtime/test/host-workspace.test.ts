import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HostWorkspace, parseLogicalWorkspacePath, WorkspaceError } from "../src/index.js";

const temporaryDirectories: string[] = [];
async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cockpit-workspace-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(async () =>
  Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  ),
);

describe("HostWorkspace", () => {
  it("round-trips binary bytes and detects optimistic-lock conflicts", async () => {
    const root = await temporaryDirectory();
    const workspace = await HostWorkspace.open(root);
    const file = parseLogicalWorkspacePath("/nested/data.bin");
    const created = await workspace.writeFile(file, Uint8Array.from([0, 255, 1]), {
      expectedSha256: null,
      createParents: true,
    });
    expect((await workspace.readFile(file)).bytes).toEqual(Uint8Array.from([0, 255, 1]));
    await fs.writeFile(path.join(root, "nested/data.bin"), "someone else wrote this");
    await expect(
      workspace.writeFile(file, Uint8Array.of(2), { expectedSha256: created.sha256 }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  });

  it("requires absence when expectedSha256 is null", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "exists"), "x");
    const workspace = await HostWorkspace.open(root);
    await expect(
      workspace.writeFile(parseLogicalWorkspacePath("/exists"), Uint8Array.of(1), {
        expectedSha256: null,
      }),
    ).rejects.toBeInstanceOf(WorkspaceError);
  });

  it("refuses reads through a symlink escaping the workspace", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await fs.writeFile(path.join(outside, "secret"), "hidden");
    await fs.symlink(path.join(outside, "secret"), path.join(root, "link"));
    const workspace = await HostWorkspace.open(root);
    await expect(workspace.readFile(parseLogicalWorkspacePath("/link"))).rejects.toMatchObject({
      code: "path_escape",
    });
  });

  it("refuses parent creation and writes through an escaping symlink", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await fs.symlink(outside, path.join(root, "redirect"));
    const workspace = await HostWorkspace.open(root);
    await expect(
      workspace.writeFile(parseLogicalWorkspacePath("/redirect/new/file"), Uint8Array.of(1), {
        expectedSha256: null,
        createParents: true,
      }),
    ).rejects.toMatchObject({ code: "path_escape" });
    await expect(fs.stat(path.join(outside, "new"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses watching a symlink target outside the workspace", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await fs.symlink(outside, path.join(root, "redirect"));
    const workspace = await HostWorkspace.open(root);
    await expect(
      workspace.watch(parseLogicalWorkspacePath("/redirect"), () => undefined),
    ).rejects.toMatchObject({ code: "path_escape" });
  });

  it("bounds file reads before allocating their contents", async () => {
    const root = await temporaryDirectory();
    await fs.writeFile(path.join(root, "large"), Buffer.alloc(20));
    const workspace = await HostWorkspace.open(root, { maxFileBytes: 10 });
    await expect(workspace.readFile(parseLogicalWorkspacePath("/large"))).rejects.toMatchObject({
      code: "resource_limit",
    });
  });

  it("lists entries without exposing host paths", async () => {
    const root = await temporaryDirectory();
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "readme.txt"), "hello");
    const workspace = await HostWorkspace.open(root);
    const entries = await workspace.list();
    expect(entries.map((entry) => entry.path).sort()).toEqual(["/readme.txt", "/src"]);
    expect(JSON.stringify(entries)).not.toContain(root);
  });
});
