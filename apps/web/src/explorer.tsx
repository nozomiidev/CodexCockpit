import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_WORKSPACE_FILES,
  openWorkspaceStore,
  type WorkspaceEntry,
} from "./workspace-store";

export type ExplorerFileKind = "code" | "json" | "markdown" | "text";

export interface ExplorerFile {
  readonly path: string;
  readonly name: string;
  readonly kind: ExplorerFileKind;
  readonly size: string;
}

interface DirectoryNode {
  readonly kind: "directory";
  readonly path: string;
  readonly name: string;
  readonly children: ExplorerNode[];
}

interface FileNode extends ExplorerFile {
  readonly kind: ExplorerFileKind;
}

type ExplorerNode = DirectoryNode | FileNode;

export interface ExplorerProps {
  readonly sessionId?: string;
  readonly files?: readonly ExplorerFile[];
  readonly onFileSelect?: (file: ExplorerFile) => void;
}

const defaultFiles: readonly ExplorerFile[] = [
  { path: "/README.md", name: "README.md", kind: "markdown", size: "2.4 KB" },
  { path: "/AGENTS.md", name: "AGENTS.md", kind: "markdown", size: "8.1 KB" },
  { path: "/package.json", name: "package.json", kind: "json", size: "1.7 KB" },
  { path: "/src/index.ts", name: "index.ts", kind: "code", size: "3.8 KB" },
  { path: "/src/protocol.ts", name: "protocol.ts", kind: "code", size: "6.2 KB" },
  { path: "/docs/mission.md", name: "mission.md", kind: "markdown", size: "4.6 KB" },
];

function buildTree(files: readonly ExplorerFile[]): DirectoryNode {
  const root: DirectoryNode = { kind: "directory", path: "/", name: "cockpit-lab", children: [] };
  const directories = new Map<string, DirectoryNode>([["/", root]]);

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) continue;
    let current = root;
    let currentPath = "";
    for (const segment of segments) {
      currentPath += `/${segment}`;
      let directory = directories.get(currentPath);
      if (!directory) {
        directory = { kind: "directory", path: currentPath, name: segment, children: [] };
        directories.set(currentPath, directory);
        current.children.push(directory);
      }
      current = directory;
    }
    current.children.push({ ...file, name: fileName });
  }

  const sortChildren = (node: DirectoryNode): void => {
    node.children.sort((left, right) => {
      if (left.kind === "directory" && right.kind !== "directory") return -1;
      if (left.kind !== "directory" && right.kind === "directory") return 1;
      return left.name.localeCompare(right.name);
    });
    for (const child of node.children) {
      if (child.kind === "directory") sortChildren(child);
    }
  };
  sortChildren(root);
  return root;
}

interface VisibleNode {
  readonly node: ExplorerNode;
  readonly level: number;
  readonly parentPath: string;
}

function flattenTree(
  node: DirectoryNode,
  expanded: ReadonlySet<string>,
  level = 1,
  parent = "/",
): readonly VisibleNode[] {
  const result: VisibleNode[] = [{ node, level, parentPath: parent }];
  if (!expanded.has(node.path)) return result;
  for (const child of node.children) {
    if (child.kind === "directory") {
      result.push(...flattenTree(child, expanded, level + 1, node.path));
    } else {
      result.push({ node: child, level: level + 1, parentPath: node.path });
    }
  }
  return result;
}

function fileIcon(kind: ExplorerFileKind) {
  if (kind === "json") return <FileJson size={14} aria-hidden="true" />;
  if (kind === "code") return <FileCode2 size={14} aria-hidden="true" />;
  return <FileText size={14} aria-hidden="true" />;
}

function fileKind(path: string): ExplorerFileKind {
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (/\.(c|m)?[jt]sx?$/.test(path) || path.endsWith(".sh")) return "code";
  return "text";
}

function displaySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function workspaceFiles(entries: readonly WorkspaceEntry[]): readonly ExplorerFile[] {
  return entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => {
      const name = entry.path.split("/").at(-1) ?? entry.path;
      return {
        path: `/${entry.path}`,
        name,
        kind: fileKind(entry.path),
        size: displaySize(entry.size),
      };
    });
}

export function Explorer({ sessionId, files, onFileSelect }: ExplorerProps) {
  const [storedFiles, setStoredFiles] = useState<readonly ExplorerFile[]>(defaultFiles);
  const displayedFiles = files ?? storedFiles;
  const tree = useMemo(() => buildTree(displayedFiles), [displayedFiles]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(["/"]));
  const [selectedPath, setSelectedPath] = useState(displayedFiles[0]?.path ?? "");
  const [focusedPath, setFocusedPath] = useState("/");
  const railButton = useRef<HTMLButtonElement>(null);
  const nodeButtons = useRef(new Map<string, HTMLButtonElement>());
  const visibleNodes = useMemo(() => flattenTree(tree, expanded), [expanded, tree]);
  const selectedFile = displayedFiles.find((file) => file.path === selectedPath);

  useEffect(() => {
    if (!sessionId || files) return;
    let cancelled = false;
    let store: { close: () => void } | undefined;
    void openWorkspaceStore({ sessionId, seedFiles: DEFAULT_WORKSPACE_FILES })
      .then(async (opened) => {
        if (cancelled) {
          opened.close();
          return;
        }
        store = opened;
        const entries = await opened.list();
        if (!cancelled) setStoredFiles(workspaceFiles(entries));
      })
      .catch(() => {
        // The static seed remains usable when IndexedDB is blocked or unavailable.
      });
    return () => {
      cancelled = true;
      store?.close();
    };
  }, [files, sessionId]);

  useEffect(() => {
    if (!displayedFiles.some((file) => file.path === selectedPath)) {
      setSelectedPath(displayedFiles[0]?.path ?? "");
    }
  }, [displayedFiles, selectedPath]);

  const closeExplorer = () => {
    setOpen(false);
    railButton.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        railButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) nodeButtons.current.get(focusedPath)?.focus();
  }, [focusedPath, open]);

  const focusNode = (path: string) => {
    setFocusedPath(path);
    nodeButtons.current.get(path)?.focus();
  };

  const selectFile = (file: ExplorerFile) => {
    setSelectedPath(file.path);
    onFileSelect?.(file);
  };

  const toggleDirectory = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleNodeKeyDown = (event: KeyboardEvent<HTMLElement>, entry: VisibleNode) => {
    const index = visibleNodes.findIndex(({ node }) => node.path === entry.node.path);
    const node = entry.node;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? index + 1 : index - 1;
      const target = visibleNodes[Math.max(0, Math.min(visibleNodes.length - 1, next))];
      if (target) focusNode(target.node.path);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = event.key === "Home" ? visibleNodes[0] : visibleNodes.at(-1);
      if (target) focusNode(target.node.path);
      return;
    }
    if (node.kind === "directory" && event.key === "ArrowRight") {
      event.preventDefault();
      if (!expanded.has(node.path)) toggleDirectory(node.path);
      else if (node.children[0]) focusNode(node.children[0].path);
      return;
    }
    if (node.kind === "directory" && event.key === "ArrowLeft") {
      event.preventDefault();
      if (expanded.has(node.path)) toggleDirectory(node.path);
      else if (entry.parentPath !== node.path) focusNode(entry.parentPath);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (node.kind === "directory") toggleDirectory(node.path);
      else selectFile(node);
    }
  };

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entry = visibleNodes.find(({ node }) => node.path === focusedPath);
    if (entry) handleNodeKeyDown(event, entry);
  };

  return (
    <div className={`explorer-dock${open ? " is-open" : ""}`}>
      <button
        ref={railButton}
        type="button"
        className="explorer-rail-button"
        data-testid="explorer-toggle"
        aria-controls="workspace-explorer"
        aria-expanded={open}
        aria-label={open ? "Close file explorer" : "Open file explorer"}
        title={open ? "Close File Explorer" : "Open File Explorer"}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <PanelLeftClose size={17} aria-hidden="true" />
        ) : (
          <PanelLeftOpen size={17} aria-hidden="true" />
        )}
        <span>EXPLORER</span>
      </button>
      {open && (
        <button
          type="button"
          className="explorer-backdrop"
          aria-label="Close file explorer"
          onClick={closeExplorer}
        />
      )}
      {open && (
        <aside
          id="workspace-explorer"
          data-testid="explorer-panel"
          className="explorer-panel"
          aria-label="Workspace file explorer"
        >
          <div className="explorer-header">
            <div>
              <small>WORKSPACE</small>
              <b>cockpit-lab</b>
            </div>
            <button
              type="button"
              className="explorer-close"
              aria-label="Close file explorer"
              onClick={closeExplorer}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="explorer-toolbar">
            <span>FILES</span>
            <small>{displayedFiles.length} items</small>
          </div>
          <div
            className="explorer-tree"
            role="tree"
            aria-label="Workspace files"
            tabIndex={0}
            onKeyDown={handleTreeKeyDown}
          >
            {visibleNodes.map((entry) => {
              const node = entry.node;
              const isDirectory = node.kind === "directory";
              const isSelected = !isDirectory && node.path === selectedPath;
              return (
                <button
                  ref={(element) => {
                    if (element) nodeButtons.current.set(node.path, element);
                    else nodeButtons.current.delete(node.path);
                  }}
                  type="button"
                  role="treeitem"
                  key={node.path}
                  data-testid={isDirectory ? "explorer-directory" : "explorer-file"}
                  className={`explorer-node${isSelected ? " is-selected" : ""}${focusedPath === node.path ? " is-focused" : ""}`}
                  style={{ paddingLeft: `${10 + entry.level * 12}px` }}
                  aria-level={entry.level}
                  aria-selected={isSelected}
                  aria-expanded={isDirectory ? expanded.has(node.path) : undefined}
                  tabIndex={focusedPath === node.path ? 0 : -1}
                  onFocus={() => setFocusedPath(node.path)}
                  onKeyDown={(event) => handleNodeKeyDown(event, entry)}
                  onClick={() => (isDirectory ? toggleDirectory(node.path) : selectFile(node))}
                >
                  {isDirectory ? (
                    expanded.has(node.path) ? (
                      <ChevronDown size={13} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={13} aria-hidden="true" />
                    )
                  ) : (
                    <span className="explorer-spacer" aria-hidden="true" />
                  )}
                  {isDirectory ? (
                    expanded.has(node.path) ? (
                      <FolderOpen size={14} aria-hidden="true" />
                    ) : (
                      <Folder size={14} aria-hidden="true" />
                    )
                  ) : (
                    fileIcon(node.kind)
                  )}
                  <span className="explorer-node-name">{node.name}</span>
                  {isSelected && (
                    <span className="explorer-active-mark" aria-hidden="true">
                      ●
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {selectedFile && (
            <div
              className="explorer-selection"
              data-testid="explorer-active-file"
              aria-live="polite"
            >
              <small>OPEN FILE</small>
              <b>{selectedFile.path}</b>
              <span>{selectedFile.size} · workspace snapshot</span>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
