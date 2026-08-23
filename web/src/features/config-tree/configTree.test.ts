import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../app/config/page.tsx", import.meta.url), "utf8");
const mosdnsPage = readFileSync(new URL("../../app/mosdns/service-config/page.tsx", import.meta.url), "utf8");
const tree = readFileSync(new URL("../../components/config/ConfigFileTree.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../../components/mihomo/YamlEditor.tsx", import.meta.url), "utf8");

describe("system configuration directory tree", () => {
  it("renders directories as accessible expandable tree items", () => {
    expect(tree).toContain('role={depth === 0 ? "tree" : "group"}');
    expect(tree).toContain('role="treeitem"');
    expect(tree).toContain("aria-expanded={directory ? open : undefined}");
    expect(tree).toContain("onToggle(path)");
    expect(page).toContain("收起全部目录");
    expect(page).toContain("展开全部目录");
    expect(page).toContain("collectSelectedDirectoryPaths(nextTree, selected)");
    expect(mosdnsPage).toContain("收起全部目录");
    expect(mosdnsPage).toContain("展开全部目录");
    expect(mosdnsPage).toContain("collectSelectedDirectoryPaths(nodes, firstConfig?.path");
    expect(mosdnsPage).toContain('setMobilePane("editor")');
    expect(page).toContain("<AppShell fillViewport>");
    expect(page).toContain("md:grid-cols-[184px_minmax(0,1fr)]");
    expect(page).toContain('maxHeight="100%"');
    expect(mosdnsPage).toContain("<AppShell fillViewport>");
    expect(mosdnsPage).toContain("MosDNS 配置管理");
    expect(mosdnsPage).toContain("md:grid-cols-[184px_minmax(0,1fr)]");
    expect(mosdnsPage).toContain('maxHeight="100%"');
  });

  it("keeps the protected Mihomo runtime config visible but read-only", () => {
    expect(page).toContain("selected === MIHOMO_RUNTIME_CONFIG");
    expect(page).toContain("readOnlyPaths={READ_ONLY_CONFIG_PATHS}");
    expect(page).toContain("readOnly={readOnly}");
    expect(editor).toContain("EditorState.readOnly.of(readOnly)");
    expect(editor).toContain("EditorView.editable.of(!readOnly)");
  });

  it("shows the resolved configuration root and file count", () => {
    expect(page).toContain("payload.absolute_path || payload.root");
    expect(page).toContain("{treeRoot} · {fileCount} 个文件");
    expect(mosdnsPage).toContain("absolute_path");
    expect(mosdnsPage).toContain("{treeRoot} · {fileCount} 个文件");
  });
});
