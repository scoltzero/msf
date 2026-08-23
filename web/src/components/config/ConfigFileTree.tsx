"use client";

import { ChevronRight, FileCode2, Folder, FolderOpen, LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConfigFileNode {
  name?: string;
  path?: string;
  type?: "file" | "dir" | "directory" | "folder" | string;
  size?: number;
  modified?: string;
  children?: ConfigFileNode[];
}

export function isConfigDirectory(node: ConfigFileNode) {
  return node.type === "dir" || node.type === "directory" || node.type === "folder" || Boolean(node.children?.length);
}

export function collectConfigDirectoryPaths(nodes: ConfigFileNode[], paths = new Set<string>()) {
  for (const node of nodes) {
    if (!isConfigDirectory(node)) continue;
    const path = node.path || node.name || "";
    if (path) paths.add(path);
    collectConfigDirectoryPaths(node.children || [], paths);
  }
  return paths;
}

export function flattenConfigFiles(nodes: ConfigFileNode[]): ConfigFileNode[] {
  return nodes.flatMap((node) => isConfigDirectory(node) ? flattenConfigFiles(node.children || []) : [node]);
}

export function countConfigFiles(nodes: ConfigFileNode[]) {
  return flattenConfigFiles(nodes).length;
}

export function ConfigFileTree({
  nodes,
  selectedPath,
  expandedPaths,
  onToggle,
  onSelect,
  readOnlyPaths,
  depth = 0,
}: {
  nodes: ConfigFileNode[];
  selectedPath: string;
  expandedPaths: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onSelect: (node: ConfigFileNode) => void;
  readOnlyPaths?: ReadonlySet<string>;
  depth?: number;
}) {
  return (
    <div role={depth === 0 ? "tree" : "group"} aria-label={depth === 0 ? "配置文件目录树" : undefined} className="space-y-0.5">
      {nodes.map((node) => {
        const path = node.path || node.name || "";
        const directory = isConfigDirectory(node);
        const open = directory && expandedPaths.has(path);
        const active = !directory && path === selectedPath;
        const readOnly = !directory && Boolean(readOnlyPaths?.has(path));
        return (
          <div key={path || node.name} role="none">
            <button
              type="button"
              role="treeitem"
              aria-expanded={directory ? open : undefined}
              aria-selected={directory ? undefined : active}
              onClick={() => directory ? onToggle(path) : onSelect(node)}
              className={cn(
                "flex min-h-8 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm transition-colors duration-150 motion-reduce:transition-none",
                active ? "bg-primary/10 font-medium text-primary" : "text-foreground hover:bg-muted/70",
                directory && "font-medium"
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              title={path}
            >
              {directory ? (
                <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} aria-hidden="true" />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              {directory ? (
                open ? <FolderOpen className="h-4 w-4 shrink-0 text-primary/80" aria-hidden="true" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <FileCode2 className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate">{node.name || path}</span>
              {readOnly ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <LockKeyhole className="h-2.5 w-2.5" aria-hidden="true" />只读
                </span>
              ) : null}
            </button>
            {directory && open && node.children?.length ? (
              <ConfigFileTree
                nodes={node.children}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                onSelect={onSelect}
                readOnlyPaths={readOnlyPaths}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
