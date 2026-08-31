/**
 * Browser-owned logical workspace persistence.
 *
 * This adapter deliberately stores only logical POSIX paths and string file
 * contents. It is useful for the static/offline lesson mode; the companion
 * remains authoritative whenever a native workspace is connected.
 */

export const WORKSPACE_DATABASE_NAME = "codex-cockpit-workspace";
export const WORKSPACE_DATABASE_VERSION = 1;
export const WORKSPACE_SEED_VERSION = "starter-v1";

const FILE_STORE = "files";
const SESSION_STORE = "sessions";
const DEFAULT_MAX_FILES = 512;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_PATH_LENGTH = 1024;
const MAX_PATH_DEPTH = 64;
const OPEN_TIMEOUT_MS = 2_500;

export interface WorkspaceSeedFile {
  readonly path: string;
  readonly content: string;
}

export type WorkspaceEntryKind = "file" | "directory";

export interface WorkspaceEntry {
  readonly path: string;
  readonly kind: WorkspaceEntryKind;
  readonly size: number;
}

export type WorkspacePersistence = "indexeddb" | "memory";

export interface WorkspaceStoreOptions {
  readonly sessionId: string;
  readonly seedFiles?: readonly WorkspaceSeedFile[];
  readonly indexedDb?: IDBFactory;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
}

export interface WorkspaceStore {
  readonly sessionId: string;
  readonly ready: Promise<void>;
  readonly persistence: WorkspacePersistence;
  list(): Promise<readonly WorkspaceEntry[]>;
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<boolean>;
  reset(): Promise<void>;
  close(): void;
}

interface FileRecord {
  readonly sessionId: string;
  readonly path: string;
  readonly content: string;
}

interface SessionRecord {
  readonly sessionId: string;
  readonly seedVersion: string;
}

interface WorkspaceLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export class WorkspacePathError extends Error {
  readonly code = "workspace_path_invalid";

  constructor(path: string, reason: string) {
    super(`Invalid workspace path "${path}": ${reason}`);
    this.name = "WorkspacePathError";
  }
}

export class WorkspaceLimitError extends Error {
  readonly code = "workspace_limit_exceeded";

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceLimitError";
  }
}

export const DEFAULT_WORKSPACE_FILES: readonly WorkspaceSeedFile[] = [
  {
    path: "README.md",
    content: "# Cockpit Lab\n\nA browser-persistent workspace for the Codex harness lesson.\n",
  },
  {
    path: "AGENTS.md",
    content: "# Workspace instructions\n\nInspect files before editing and keep changes focused.\n",
  },
  {
    path: "src/index.ts",
    content: 'export const greeting = "Hello from the cockpit workspace";\n',
  },
  {
    path: "package.json",
    content: '{\n  "name": "cockpit-lab",\n  "private": true\n}\n',
  },
  {
    path: "scripts/check.sh",
    content: "#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' 'workspace check passed'\n",
  },
];

/** Validate and canonicalize a browser logical path. */
export function validateWorkspacePath(path: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new WorkspacePathError(path, "path must not be empty");
  }
  if (path.length > MAX_PATH_LENGTH) {
    throw new WorkspacePathError(path, `path exceeds ${MAX_PATH_LENGTH} characters`);
  }
  if (path.includes("\0")) {
    throw new WorkspacePathError(path, "NUL is not allowed");
  }
  if (path.startsWith("/") || path.startsWith("\\")) {
    throw new WorkspacePathError(path, "path must be relative");
  }
  if (path.includes("\\")) {
    throw new WorkspacePathError(path, "backslash separators are not allowed");
  }
  const segments = path.split("/");
  if (segments.length > MAX_PATH_DEPTH) {
    throw new WorkspacePathError(path, `path exceeds ${MAX_PATH_DEPTH} segments`);
  }
  if (segments.some((segment) => segment.length === 0)) {
    throw new WorkspacePathError(path, "empty path segments are not allowed");
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new WorkspacePathError(path, "dot segments are not allowed");
  }
  return path.normalize("NFC");
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value).byteLength;
  return new Blob([value]).size;
}

function createLimits(options: WorkspaceStoreOptions): WorkspaceLimits {
  const limits = {
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  };
  if (
    !Number.isSafeInteger(limits.maxFiles) ||
    limits.maxFiles < 1 ||
    !Number.isSafeInteger(limits.maxFileBytes) ||
    limits.maxFileBytes < 1 ||
    !Number.isSafeInteger(limits.maxTotalBytes) ||
    limits.maxTotalBytes < 1
  ) {
    throw new RangeError("Workspace limits must be positive safe integers");
  }
  return limits;
}

function normalizeSeeds(
  seeds: readonly WorkspaceSeedFile[],
  limits: WorkspaceLimits,
): WorkspaceSeedFile[] {
  const result = new Map<string, string>();
  for (const seed of seeds) {
    const path = validateWorkspacePath(seed.path);
    if (typeof seed.content !== "string")
      throw new TypeError(`Seed content for ${path} must be a string`);
    result.set(path, seed.content);
  }
  const files = [...result].map(([path, content]) => ({ path, content }));
  if (files.length > limits.maxFiles)
    throw new WorkspaceLimitError("Seed file count exceeds workspace limit");
  let totalBytes = 0;
  for (const file of files) {
    const size = byteLength(file.content);
    if (size > limits.maxFileBytes) {
      throw new WorkspaceLimitError(`Seed file ${file.path} exceeds the per-file workspace limit`);
    }
    totalBytes += size;
  }
  if (totalBytes > limits.maxTotalBytes)
    throw new WorkspaceLimitError("Seed files exceed workspace byte limit");
  return files.sort((left, right) => comparePaths(left.path, right.path));
}

function buildEntries(files: ReadonlyMap<string, string>): readonly WorkspaceEntry[] {
  const entries = new Map<string, WorkspaceEntry>();
  for (const [path, content] of files) {
    entries.set(path, { path, kind: "file", size: byteLength(content) });
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const directory = segments.slice(0, index).join("/");
      if (!entries.has(directory))
        entries.set(directory, { path: directory, kind: "directory", size: 0 });
    }
  }
  return [...entries.values()].sort((left, right) => {
    const pathOrder = comparePaths(left.path, right.path);
    return pathOrder || (left.kind === right.kind ? 0 : left.kind === "directory" ? -1 : 1);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed")),
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed")),
    );
  });
}

function openDatabase(indexedDb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDb.open(WORKSPACE_DATABASE_NAME, WORKSPACE_DATABASE_VERSION);
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("IndexedDB open timed out"));
    }, OPEN_TIMEOUT_MS);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FILE_STORE)) {
        database.createObjectStore(FILE_STORE, { keyPath: ["sessionId", "path"] });
      }
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        database.createObjectStore(SESSION_STORE, { keyPath: "sessionId" });
      }
    });
    request.addEventListener("success", () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeout);
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      reject(request.error ?? new Error("IndexedDB open failed"));
    });
    request.addEventListener("blocked", () => undefined);
  });
}

const memoryWorkspaces = new Map<string, Map<string, string>>();

export function createWorkspaceStore(options: WorkspaceStoreOptions): WorkspaceStore {
  const sessionId = options.sessionId.trim();
  if (!sessionId || sessionId.length > 256)
    throw new RangeError("sessionId must be 1–256 characters");
  const limits = createLimits(options);
  const seeds = normalizeSeeds(options.seedFiles ?? DEFAULT_WORKSPACE_FILES, limits);
  const files = memoryWorkspaces.get(sessionId) ?? new Map<string, string>();
  memoryWorkspaces.set(sessionId, files);
  let database: IDBDatabase | undefined;
  let persistence: WorkspacePersistence = "memory";
  let closed = false;
  let queue = Promise.resolve();

  const initialize = (async () => {
    const indexedDb =
      options.indexedDb ??
      (typeof globalThis.indexedDB === "undefined" ? undefined : globalThis.indexedDB);
    if (!indexedDb) {
      if (files.size === 0) for (const seed of seeds) files.set(seed.path, seed.content);
      return;
    }
    try {
      database = await openDatabase(indexedDb);
      const readTransaction = database.transaction([FILE_STORE, SESSION_STORE], "readonly");
      const session = await requestResult(
        readTransaction.objectStore(SESSION_STORE).get(sessionId),
      );
      const records = (
        await requestResult(readTransaction.objectStore(FILE_STORE).getAll())
      ).filter((record): record is FileRecord => record.sessionId === sessionId);
      await transactionComplete(readTransaction);
      files.clear();
      if (!session) {
        for (const seed of seeds) files.set(seed.path, seed.content);
        const writeTransaction = database.transaction([FILE_STORE, SESSION_STORE], "readwrite");
        const fileStore = writeTransaction.objectStore(FILE_STORE);
        for (const seed of seeds)
          fileStore.put({ sessionId, path: seed.path, content: seed.content } satisfies FileRecord);
        writeTransaction
          .objectStore(SESSION_STORE)
          .put({ sessionId, seedVersion: WORKSPACE_SEED_VERSION } satisfies SessionRecord);
        await transactionComplete(writeTransaction);
      } else {
        for (const record of records) files.set(record.path, record.content);
      }
      persistence = "indexeddb";
    } catch {
      database?.close();
      database = undefined;
      if (files.size === 0) for (const seed of seeds) files.set(seed.path, seed.content);
      persistence = "memory";
    }
  })();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(async () => {
      if (closed) throw new Error("Workspace store is closed");
      await initialize;
      return operation();
    });
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const persistRecord = async (path: string, content: string): Promise<void> => {
    if (!database || persistence !== "indexeddb") return;
    try {
      const transaction = database.transaction(FILE_STORE, "readwrite");
      transaction.objectStore(FILE_STORE).put({ sessionId, path, content } satisfies FileRecord);
      await transactionComplete(transaction);
    } catch {
      persistence = "memory";
      database?.close();
      database = undefined;
    }
  };

  const store: WorkspaceStore = {
    sessionId,
    ready: initialize,
    get persistence() {
      return persistence;
    },
    list: () => enqueue(async () => buildEntries(files)),
    read: (path) =>
      enqueue(async () => {
        const normalized = validateWorkspacePath(path);
        return files.get(normalized);
      }),
    write: (path, content) =>
      enqueue(async () => {
        const normalized = validateWorkspacePath(path);
        const size = byteLength(content);
        if (size > limits.maxFileBytes)
          throw new WorkspaceLimitError("File exceeds the per-file workspace limit");
        const previous = files.get(normalized);
        if (previous === undefined && files.size >= limits.maxFiles) {
          throw new WorkspaceLimitError("File count exceeds workspace limit");
        }
        let totalBytes = 0;
        for (const [filePath, fileContent] of files)
          totalBytes += filePath === normalized ? size : byteLength(fileContent);
        if (previous === undefined) totalBytes += size;
        if (totalBytes > limits.maxTotalBytes)
          throw new WorkspaceLimitError("Workspace byte limit exceeded");
        await persistRecord(normalized, content);
        files.set(normalized, content);
      }),
    remove: (path) =>
      enqueue(async () => {
        const normalized = validateWorkspacePath(path);
        if (!files.has(normalized)) return false;
        if (database && persistence === "indexeddb") {
          try {
            const transaction = database.transaction(FILE_STORE, "readwrite");
            transaction.objectStore(FILE_STORE).delete([sessionId, normalized]);
            await transactionComplete(transaction);
          } catch {
            persistence = "memory";
            database?.close();
            database = undefined;
          }
        }
        files.delete(normalized);
        return true;
      }),
    reset: () =>
      enqueue(async () => {
        if (database && persistence === "indexeddb") {
          try {
            const transaction = database.transaction([FILE_STORE, SESSION_STORE], "readwrite");
            const fileStore = transaction.objectStore(FILE_STORE);
            const records = (
              await requestResult(
                database.transaction(FILE_STORE, "readonly").objectStore(FILE_STORE).getAll(),
              )
            ).filter((record): record is FileRecord => record.sessionId === sessionId);
            for (const record of records) fileStore.delete([sessionId, record.path]);
            for (const seed of seeds)
              fileStore.put({
                sessionId,
                path: seed.path,
                content: seed.content,
              } satisfies FileRecord);
            transaction
              .objectStore(SESSION_STORE)
              .put({ sessionId, seedVersion: WORKSPACE_SEED_VERSION } satisfies SessionRecord);
            await transactionComplete(transaction);
          } catch {
            persistence = "memory";
            database?.close();
            database = undefined;
          }
        }
        files.clear();
        for (const seed of seeds) files.set(seed.path, seed.content);
      }),
    close: () => {
      closed = true;
      database?.close();
      database = undefined;
    },
  };
  return store;
}

export async function openWorkspaceStore(options: WorkspaceStoreOptions): Promise<WorkspaceStore> {
  const store = createWorkspaceStore(options);
  await store.ready;
  return store;
}
