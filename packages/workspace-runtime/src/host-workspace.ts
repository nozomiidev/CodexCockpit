import { createHash, randomUUID } from "node:crypto";
import { type FSWatcher, promises as fs, watch as fsWatch } from "node:fs";
import * as path from "node:path";
import { WorkspaceError } from "./errors.js";
import {
  type LogicalWorkspacePath,
  parseLogicalWorkspacePath,
  resolveLogicalWorkspacePath,
} from "./logical-path.js";
import {
  PortableTerminalSession,
  type TerminalSession,
  type TerminalSessionOptions,
} from "./terminal.js";

export interface WorkspaceRevision {
  readonly sha256: string;
  readonly byteLength: number;
  readonly modifiedAtMs: number;
}

export interface WorkspaceFile extends WorkspaceRevision {
  readonly path: LogicalWorkspacePath;
  readonly bytes: Uint8Array;
}

export interface WorkspaceEntry {
  readonly path: LogicalWorkspacePath;
  readonly kind: "file" | "directory" | "symlink";
  readonly byteLength?: number;
}

export interface WorkspaceChange {
  readonly path: LogicalWorkspacePath;
  readonly kind: "changed" | "renamed";
}

export interface WriteFileOptions {
  /** `null` means the file must not exist; omitted means unconditional replacement. */
  readonly expectedSha256?: string | null;
  readonly createParents?: boolean;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class HostWorkspace {
  readonly #root: string;
  readonly #maxFileBytes: number;

  private constructor(root: string, maxFileBytes: number) {
    this.#root = root;
    this.#maxFileBytes = maxFileBytes;
  }

  static async open(
    root: string,
    options: { readonly maxFileBytes?: number } = {},
  ): Promise<HostWorkspace> {
    const canonicalRoot = await fs.realpath(root);
    const stat = await fs.stat(canonicalRoot);
    if (!stat.isDirectory())
      throw new WorkspaceError("path_not_found", "Workspace root is not a directory");
    return new HostWorkspace(canonicalRoot, options.maxFileBytes ?? 16 * 1024 * 1024);
  }

  async list(
    logicalPath: LogicalWorkspacePath = parseLogicalWorkspacePath("/"),
  ): Promise<WorkspaceEntry[]> {
    const hostPath = await this.#existingPath(logicalPath);
    const entries = await fs.readdir(hostPath, { withFileTypes: true });
    return Promise.all(
      entries.map(async (entry) => {
        const child = parseLogicalWorkspacePath(
          `${logicalPath === "/" ? "" : logicalPath}/${entry.name}`,
        );
        const stat = await fs.lstat(path.join(hostPath, entry.name));
        return {
          path: child,
          kind: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : "file",
          ...(entry.isFile() ? { byteLength: stat.size } : {}),
        } satisfies WorkspaceEntry;
      }),
    );
  }

  /**
   * Starts the portable shell fallback at the authorized workspace root. The root path
   * remains encapsulated so browser and relay adapters cannot accidentally disclose it.
   */
  openTerminal(options: Omit<TerminalSessionOptions, "cwd"> = {}): TerminalSession {
    return new PortableTerminalSession({ ...options, cwd: this.#root });
  }

  async readFile(logicalPath: LogicalWorkspacePath): Promise<WorkspaceFile> {
    const hostPath = await this.#existingPath(logicalPath);
    const handle = await fs.open(hostPath, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile())
        throw new WorkspaceError("path_not_found", "Workspace path is not a file");
      if (stat.size > this.#maxFileBytes) {
        throw new WorkspaceError("resource_limit", "File exceeds the configured read limit", {
          byteLength: stat.size,
          maxFileBytes: this.#maxFileBytes,
        });
      }
      const bytes = Uint8Array.from(await handle.readFile());
      return {
        path: logicalPath,
        bytes,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
        modifiedAtMs: stat.mtimeMs,
      };
    } finally {
      await handle.close();
    }
  }

  async writeFile(
    logicalPath: LogicalWorkspacePath,
    bytes: Uint8Array,
    options: WriteFileOptions = {},
  ): Promise<WorkspaceRevision> {
    if (logicalPath === "/")
      throw new WorkspaceError("invalid_logical_path", "Cannot write the workspace root");
    if (bytes.byteLength > this.#maxFileBytes) {
      throw new WorkspaceError("resource_limit", "File exceeds the configured write limit");
    }
    const lexicalTarget = resolveLogicalWorkspacePath(this.#root, logicalPath);
    const lexicalParent = path.dirname(lexicalTarget);
    if (options.createParents) await this.#createParentsWithoutFollowingSymlinks(lexicalParent);
    const parent = await fs.realpath(lexicalParent);
    await this.#assertInside(parent);
    // Use the canonical parent for all subsequent I/O. A lexical ancestor cannot redirect
    // this operation if it is replaced with a symlink after the containment check.
    const target = path.join(parent, path.basename(lexicalTarget));
    await this.#assertExpectedRevision(target, options.expectedSha256);

    const temporary = path.join(parent, `.${path.basename(lexicalTarget)}.${randomUUID()}.tmp`);
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Recheck immediately before the atomic rename to narrow the optimistic-lock race.
      await this.#assertExpectedRevision(target, options.expectedSha256);
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    const stat = await fs.stat(target);
    return { sha256: sha256(bytes), byteLength: bytes.byteLength, modifiedAtMs: stat.mtimeMs };
  }

  async watch(
    logicalPath: LogicalWorkspacePath,
    listener: (change: WorkspaceChange) => void,
  ): Promise<{ close(): void }> {
    const hostPath = await this.#existingPath(logicalPath);
    let watcher: FSWatcher;
    try {
      watcher = fsWatch(hostPath, { recursive: true }, (eventType, filename) => {
        if (filename === null) return;
        const relative = filename.toString().split(path.sep).join("/");
        try {
          listener({
            path: parseLogicalWorkspacePath(
              `${logicalPath === "/" ? "" : logicalPath}/${relative}`,
            ),
            kind: eventType === "rename" ? "renamed" : "changed",
          });
        } catch {
          // OS watcher names are untrusted; invalid names are deliberately not exposed.
        }
      });
    } catch (cause) {
      throw new WorkspaceError("path_not_found", "Unable to watch workspace path", {}, { cause });
    }
    return { close: () => watcher.close() };
  }

  async #existingPath(logicalPath: LogicalWorkspacePath): Promise<string> {
    const lexical = resolveLogicalWorkspacePath(this.#root, logicalPath);
    try {
      const real = await fs.realpath(lexical);
      await this.#assertInside(real);
      return real;
    } catch (cause) {
      if (cause instanceof WorkspaceError) throw cause;
      throw new WorkspaceError("path_not_found", "Workspace path does not exist", {}, { cause });
    }
  }

  async #assertInside(realPath: string): Promise<void> {
    if (realPath !== this.#root && !realPath.startsWith(`${this.#root}${path.sep}`)) {
      throw new WorkspaceError("path_escape", "A symbolic link escaped the workspace root");
    }
  }

  async #createParentsWithoutFollowingSymlinks(parent: string): Promise<void> {
    const relative = path.relative(this.#root, parent);
    let cursor = this.#root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      try {
        const stat = await fs.lstat(cursor);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new WorkspaceError("path_escape", "A write parent is not a workspace directory");
        }
      } catch (cause) {
        if (cause instanceof WorkspaceError) throw cause;
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        await fs.mkdir(cursor);
      }
    }
  }

  async #assertExpectedRevision(
    target: string,
    expected: string | null | undefined,
  ): Promise<void> {
    if (expected === undefined) return;
    let actual: string | null = null;
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink())
        throw new WorkspaceError("path_escape", "Refusing to replace a symbolic link");
      actual = sha256(await fs.readFile(target));
    } catch (cause) {
      if (cause instanceof WorkspaceError) throw cause;
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw cause;
    }
    if (actual !== expected) {
      throw new WorkspaceError("revision_conflict", "File changed since it was read", {
        expectedSha256: expected ?? "missing",
        actualSha256: actual ?? "missing",
      });
    }
  }
}
