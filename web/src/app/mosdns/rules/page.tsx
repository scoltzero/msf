"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Shield,
  ListFilter,
  ShieldOff,
  GitBranch,
  Search,
  Plus,
  Download,
  Upload,
  RefreshCw,
  Trash2,
  GripVertical,
  Pencil,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import type { Rule, RuleCategory } from "@/lib/mosdns-rules-data";
import {
  AddRuleModal,
  AddRuleSetModal,
  EditRuleModal,
  ImportRulesModal,
  ClearConfirmModal,
  ToastStack,
  type ToastItem,
  type RuleSetFormValues,
  type RuleSetTypeOption,
} from "@/components/rules/RuleDialogs";
import { AdblockView, RoutingView, type RuleSetRow } from "@/components/rules/RuleViews";
import { api, apiData, apiList, getToken } from "@/lib/api";

type PageRule = Rule & {
  id?: string;
  pattern?: string;
  order?: number;
};

type RuleSetPayload = {
  id: string;
  name: string;
  type?: string;
  files?: string;
  url: string;
  enabled: boolean;
  auto_update?: boolean;
  update_interval_hours?: number;
  rule_count?: number;
  last_updated?: string;
  source_type?: string;
};

const views: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "personlist", label: "个性化名单", icon: ListFilter },
  { id: "adblock", label: "广告拦截", icon: ShieldOff },
  { id: "routing", label: "在线分流", icon: GitBranch },
];

function initialViewFromUrl() {
  if (typeof window === "undefined") return "personlist";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return views.some((view) => view.id === tab) ? tab || "personlist" : "personlist";
}

const GRID = "grid-cols-[60px_100px_120px_1fr_120px]";
const typeLabels: Record<string, { label: string; color: string }> = {
  geositecn: { label: "中国域名 (geositecn)", color: "blue" },
  geositenocn: { label: "非中国域名 (geositenocn)", color: "purple" },
  geoipcn: { label: "中国IP (geoipcn)", color: "green" },
  cuscn: { label: "国内加速域名 (!cn@cn)", color: "orange" },
  cusnocn: { label: "国外专属域名 (cn@!cn)", color: "pink" },
};

const routingRuleSetTypes: RuleSetTypeOption[] = [
  { value: "geositecn", label: "中国域名 (geositecn)" },
  { value: "geositenocn", label: "非中国域名 (geositenocn)" },
  { value: "geoipcn", label: "中国IP (geoipcn)" },
  { value: "cuscn", label: "国内加速域名 (!cn@cn)" },
  { value: "cusnocn", label: "国外专属域名 (cn@!cn)" },
];

const adguardRuleSetTypes: RuleSetTypeOption[] = [
  { value: "adguard", label: "广告拦截 (adguard)" },
];

function categoryFromPayload(item: any): RuleCategory {
  return {
    id: String(item.id || item.key || "whitelist"),
    label: String(item.label || item.name || item.id || "规则"),
    count: Number(item.count || 0),
    rules: [],
  };
}

function patternFor(mode: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(domain|full|keyword|regexp):/.test(trimmed)) return trimmed;
  return `${mode}:${trimmed}`;
}

function normalizeRule(item: any, category: string): PageRule {
  const pattern = String(item.pattern || "");
  let mode = String(item.match_mode || item.mode || "");
  let content = String(item.content || item.name || item.value || "");
  if (!content && pattern) {
    const match = pattern.match(/^(domain|full|keyword|regexp):(.+)$/);
    if (match) {
      mode = match[1];
      content = match[2];
    } else {
      content = pattern;
    }
  }
  return {
    id: item.id,
    type: String(item.type || item.category || category),
    mode: mode || "默认",
    content,
    pattern: pattern || patternFor(mode || "domain", content),
    order: Number(item.order || 0),
  };
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function normalizeRuleSet(item: RuleSetPayload): RuleSetRow {
  const type = item.type || item.source_type || "srs";
  const meta = typeLabels[type] || { label: `${type}`, color: "blue" };
  return {
    id: item.id,
    name: item.name,
    url: item.url || "",
    ruleCount: Number(item.rule_count || 0).toLocaleString(),
    updatedAt: formatDate(item.last_updated),
    enabled: item.enabled !== false,
    type,
    sourceType: item.source_type || (type === "adguard" ? "adguard" : "srs"),
    files: item.files,
    typeKey: type,
    typeLabel: meta.label,
    color: meta.color,
  } as RuleSetRow;
}

export default function MosdnsRulesPage() {
  const [activeView, setActiveView] = useState(initialViewFromUrl);
  const [categories, setCategories] = useState<RuleCategory[]>([]);
  const [activeCat, setActiveCat] = useState("");
  const [currentRules, setCurrentRules] = useState<PageRule[]>([]);
  const [ruleSets, setRuleSets] = useState<RuleSetRow[]>([]);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<null | "add" | "import" | "clear">(null);
  const [ruleSetModal, setRuleSetModal] = useState<null | "adguard" | "srs">(null);
  const [editingRule, setEditingRule] = useState<PageRule | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [draggingRuleKey, setDraggingRuleKey] = useState("");
  const [dragOverRuleKey, setDragOverRuleKey] = useState("");
  const toastIdRef = useRef(0);

  const category = categories.find((item) => item.id === activeCat) || categories[0];
  const rules = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? currentRules.filter((rule) => rule.content.toLowerCase().includes(q) || (rule.pattern || "").toLowerCase().includes(q)) : currentRules;
  }, [currentRules, query]);
  const adblockRules = useMemo(() => ruleSets.filter((item) => item.sourceType === "adguard" || item.type === "adguard"), [ruleSets]);
  const routingRules = useMemo(() => ruleSets.filter((item) => item.sourceType !== "adguard" && item.type !== "adguard"), [ruleSets]);

  const showToast = useCallback((message: string) => {
    const id = (toastIdRef.current += 1);
    setToasts((current) => [...current, { id, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 2500);
  }, []);

  const switchView = (viewId: string) => {
    setActiveView(viewId);
    const url = new URL(window.location.href);
    if (viewId === "personlist") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", viewId);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const loadCategories = useCallback(async () => {
    try {
      const payload = await api("/api/v1/mosdns/rules/categories");
      const nextCategories = apiList<any>(payload, ["data", "categories"]).map(categoryFromPayload);
      setCategories(nextCategories);
      setActiveCat((current) => (nextCategories.some((item) => item.id === current) ? current : nextCategories[0]?.id || ""));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "规则分类加载失败");
    }
  }, [showToast]);

  const loadRules = useCallback(
    async (categoryId: string) => {
      if (!categoryId) return;
      setLoading(true);
      try {
        const payload = await api(`/api/v1/mosdns/rules/${encodeURIComponent(categoryId)}`);
        const items = apiList<any>(payload, ["data", "rules", "items"]).map((item) => normalizeRule(item, categoryId));
        setCurrentRules(items);
        setCategories((current) => current.map((item) => (item.id === categoryId ? { ...item, count: items.length } : item)));
      } catch (error) {
        showToast(error instanceof Error ? error.message : "规则加载失败");
      } finally {
        setLoading(false);
      }
    },
    [showToast]
  );

  const loadRuleSets = useCallback(async () => {
    try {
      const payload = await api("/api/v1/mosdns/rule-sets");
      const data = apiData<any>(payload, payload);
      const items = apiList<RuleSetPayload>(data, ["items", "rule_sets", "sources", "data"]);
      setRuleSets(items.map(normalizeRuleSet));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "规则源加载失败");
    }
  }, [showToast]);

  useEffect(() => {
    void loadCategories();
    void loadRuleSets();
  }, [loadCategories, loadRuleSets]);

  useEffect(() => {
    if (activeView === "personlist" && activeCat) void loadRules(activeCat);
  }, [activeCat, activeView, loadRules]);

  const refreshAll = async () => {
    await Promise.all([loadCategories(), loadRuleSets(), activeCat ? loadRules(activeCat) : Promise.resolve()]);
  };

  const handleAdd = async (pattern: string) => {
    if (!activeCat) return;
    try {
      await api(`/api/v1/mosdns/rules/${encodeURIComponent(activeCat)}`, {
        method: "POST",
        body: JSON.stringify({ pattern }),
      });
      setModal(null);
      showToast("添加成功");
      await loadRules(activeCat);
      await loadCategories();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "添加失败");
    }
  };

  const handleImport = async (text: string) => {
    if (!activeCat) return;
    try {
      await api(`/api/v1/mosdns/rules/${encodeURIComponent(activeCat)}/import`, {
        method: "POST",
        body: JSON.stringify({ content: text, append: false }),
      });
      setModal(null);
      showToast("导入成功");
      await loadRules(activeCat);
      await loadCategories();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "导入失败");
    }
  };

  const handleExport = () => {
    if (!activeCat) return;
    const token = getToken();
    window.location.href = `/api/v1/mosdns/rules/${encodeURIComponent(activeCat)}/export${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  };

  const handleClear = async () => {
    if (!activeCat) return;
    try {
      await api(`/api/v1/mosdns/rules/${encodeURIComponent(activeCat)}/all`, { method: "DELETE" });
      setModal(null);
      showToast("已清空");
      await loadRules(activeCat);
      await loadCategories();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "清空失败");
    }
  };

  const editRule = async (rule: PageRule, mode: string, value: string) => {
    if (!activeCat) return;
    try {
      await api(`/api/v1/mosdns/rules/${encodeURIComponent(activeCat)}`, {
        method: "PUT",
        body: JSON.stringify({ old_pattern: rule.pattern, new_pattern: patternFor(mode, value) }),
      });
      setEditingRule(null);
      showToast("规则已更新");
      await loadRules(activeCat);
      await loadCategories();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "规则更新失败");
    }
  };

  const deleteRule = async (rule: PageRule) => {
    if (!activeCat || !window.confirm("确认删除这条规则？")) return;
    try {
      await api(`/api/v1/mosdns/rules/${encodeURIComponent(activeCat)}`, {
        method: "DELETE",
        body: JSON.stringify({ pattern: rule.pattern }),
      });
      showToast("规则已删除");
      await loadRules(activeCat);
      await loadCategories();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "规则删除失败");
    }
  };

  const addRuleSet = (sourceType: "adguard" | "srs") => {
    setRuleSetModal(sourceType);
  };

  const createRuleSet = async (sourceType: "adguard" | "srs", values: RuleSetFormValues) => {
    try {
      await api(`/api/v1/mosdns/rule-sets?source_type=${sourceType}`, {
        method: "POST",
        body: JSON.stringify({
          name: values.name,
          url: values.url,
          type: sourceType === "adguard" ? "adguard" : values.type,
          files: sourceType === "srs" ? values.files : undefined,
          enabled: true,
          auto_update: values.autoUpdate,
          update_interval_hours: values.updateIntervalHours,
        }),
      });
      setRuleSetModal(null);
      showToast("规则源已添加");
      await loadRuleSets();
      await loadCategories();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "规则源添加失败");
    }
  };

  const editRuleSet = async (item: RuleSetRow) => {
    const name = window.prompt("规则源名称", item.name);
    if (name === null) return;
    const url = window.prompt("规则源 URL", item.url);
    if (url === null) return;
    try {
      await api(`/api/v1/mosdns/rule-sets/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        body: JSON.stringify({ name, url, type: item.type, files: item.files }),
      });
      showToast("规则源已保存");
      await loadRuleSets();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "规则源保存失败");
    }
  };

  const toggleRuleSet = async (item: RuleSetRow) => {
    try {
      await api(`/api/v1/mosdns/rule-sets/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      showToast("规则源状态已保存");
      await loadRuleSets();
      await loadCategories();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "规则源状态保存失败");
    }
  };

  const updateRuleSet = async (item: RuleSetRow) => {
    try {
      await api(`/api/v1/mosdns/rule-sets/${encodeURIComponent(item.id)}/update`, { method: "POST" });
      showToast("规则源已更新");
      await loadRuleSets();
      await loadCategories();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "规则源更新失败");
    }
  };

  const deleteRuleSet = async (item: RuleSetRow) => {
    if (!window.confirm("确认删除这个规则源？")) return;
    try {
      await api(`/api/v1/mosdns/rule-sets/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      showToast("规则源已删除");
      await loadRuleSets();
      await loadCategories();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "规则源删除失败");
    }
  };

  const updateAllRuleSets = async (sourceType: "adguard" | "srs") => {
    try {
      await api(`/api/v1/mosdns/rule-sets/update?source_type=${sourceType}`, { method: "POST" });
      showToast("规则源更新完成");
      await loadRuleSets();
      await loadCategories();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "规则源更新失败");
    }
  };

  const keyForRule = (rule: PageRule, index?: number) => rule.pattern || rule.id || `${rule.content}:${index ?? rule.order ?? ""}`;

  const persistRuleOrder = async (nextRules: PageRule[]) => {
    if (!activeCat) return;
    const previous = currentRules;
    setCurrentRules(nextRules.map((rule, index) => ({ ...rule, order: index + 1 })));
    try {
      await api(`/api/v1/mosdns/rules/${encodeURIComponent(activeCat)}/reorder`, {
        method: "PUT",
        body: JSON.stringify({
          items: nextRules.map((rule) => ({ pattern: rule.pattern || patternFor(rule.mode === "默认" ? "domain" : rule.mode, rule.content) })),
        }),
      });
      showToast("排序已保存");
      await loadRules(activeCat);
    } catch (error) {
      setCurrentRules(previous);
      showToast(error instanceof Error ? error.message : "排序保存失败");
    }
  };

  const handleDropRule = (target: PageRule, targetIndex: number) => {
    if (!draggingRuleKey) return;
    const targetKey = keyForRule(target, targetIndex);
    if (draggingRuleKey === targetKey) return;
    const sourceIndex = currentRules.findIndex((rule, index) => keyForRule(rule, index) === draggingRuleKey);
    const destinationIndex = currentRules.findIndex((rule, index) => keyForRule(rule, index) === targetKey);
    if (sourceIndex < 0 || destinationIndex < 0) return;
    const nextRules = [...currentRules];
    const [moved] = nextRules.splice(sourceIndex, 1);
    nextRules.splice(destinationIndex, 0, moved);
    void persistRuleOrder(nextRules);
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-4 py-3 md:py-4 bg-gradient-to-r from-muted/30 via-muted/10 to-transparent rounded-xl border border-border/50 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 border border-primary/20 shadow-sm">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-foreground leading-none">规则管理</h1>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1">MosDNS 域名和 IP 规则</p>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto overflow-y-visible scrollbar-hide -mx-2 px-2 py-2">
            {views.map((view) => {
              const Icon = view.icon;
              const active = view.id === activeView;
              return (
                <button
                  key={view.id}
                  onClick={() => switchView(view.id)}
                  className={cn(
                    "relative px-3 md:px-4 py-1.5 rounded-lg border transition-all duration-200 text-sm font-semibold whitespace-nowrap flex items-center gap-2",
                    active
                      ? "border-primary bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-md scale-105 z-10"
                      : "border-border/50 text-muted-foreground hover:border-primary/50 hover:bg-accent/50 hover:scale-105 hover:z-10"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{view.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {activeView === "personlist" && category && (
          <div className="animate-fade-in space-y-4">
            <div className="rounded-xl border border-border/50 bg-card p-4 md:p-6 shadow-sm">
              <div className="mb-3 overflow-x-auto overflow-y-visible scrollbar-hide -mx-2 px-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 min-w-0 p-2">
                  {categories.map((item) => {
                    const active = item.id === activeCat;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveCat(item.id)}
                        className={cn(
                          "group relative px-3 py-1.5 rounded-lg border-2 transition-all duration-300 text-sm font-bold overflow-hidden min-w-0",
                          active
                            ? "border-primary bg-gradient-to-br from-primary/25 via-primary/15 to-primary/5 text-primary shadow-lg shadow-primary/20 scale-105 z-10"
                            : "border-border/40 text-muted-foreground hover:border-primary/50 hover:bg-accent/40"
                        )}
                      >
                        <div className="relative flex items-center justify-center gap-1.5 min-w-0">
                          <span className="text-xs md:text-sm truncate">{item.label}</span>
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-bold flex-shrink-0", active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
                            {item.count}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="模糊搜索规则内容..."
                    className="w-full pl-11 pr-11 py-3 text-sm rounded-xl border-2 border-border/50 bg-gradient-to-r from-background to-muted/20 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setModal("add")} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:bg-primary/90 transition-colors">
                    <Plus className="h-4 w-4" />添加
                  </button>
                  <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-background text-sm font-medium text-foreground hover:bg-accent transition-colors">
                    <Download className="h-4 w-4" />导出规则
                  </button>
                  <button onClick={() => setModal("import")} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-background text-sm font-medium text-foreground hover:bg-accent transition-colors">
                    <Upload className="h-4 w-4" />导入规则
                  </button>
                  <button onClick={() => void refreshAll()} className="group inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-background text-sm font-medium text-foreground hover:bg-accent transition-colors">
                    <RefreshCw className={cn("h-4 w-4 group-active:rotate-180 transition-transform duration-500", loading && "animate-spin")} />刷新
                  </button>
                  <button onClick={() => setModal("clear")} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-destructive/30 bg-background text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 className="h-4 w-4" />清空
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-[12px] border bg-card text-card-foreground !border-border/20 overflow-hidden">
              <div className="flex items-center justify-between border-b-2 border-border/30 bg-gradient-to-r from-muted/40 via-muted/10 to-transparent px-4 py-3">
                <h3 className="tracking-tight text-foreground text-base font-bold flex items-center gap-3">
                  <div className="h-8 w-1 bg-gradient-to-b from-primary via-primary to-primary/50 rounded-full" />
                  <span className="bg-gradient-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">{category.label}</span>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-primary/20 to-primary/10 text-primary border border-primary/20">{currentRules.length} 条</span>
                </h3>
                <button
                  type="button"
                  onClick={() => showToast("拖动每行右侧把手即可调整排序")}
                  className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/60 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  <GripVertical className="h-3.5 w-3.5" />拖拽排序
                </button>
              </div>

              <div className={cn("hidden md:grid", GRID, "text-xs font-bold text-muted-foreground px-4 py-2 bg-gradient-to-r from-muted/30 to-transparent border-b border-border/30")}>
                <span className="text-center">序号</span>
                <span className="text-center">类型</span>
                <span className="text-center">匹配模式</span>
                <span>规则内容</span>
                <span className="text-right">操作</span>
              </div>

              <div>
                {rules.map((rule, index) => {
                  const ruleKey = keyForRule(rule, index);
                  return (
                  <div
                    key={rule.id || rule.pattern || index}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverRuleKey(ruleKey);
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDropRule(rule, index);
                      setDraggingRuleKey("");
                      setDragOverRuleKey("");
                    }}
                    onDragEnd={() => {
                      setDraggingRuleKey("");
                      setDragOverRuleKey("");
                    }}
                    className={cn(
                      "group relative grid items-center px-4 py-1.5 border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors",
                      GRID,
                      draggingRuleKey === ruleKey && "opacity-50",
                      dragOverRuleKey === ruleKey && draggingRuleKey !== ruleKey && "bg-primary/5"
                    )}
                  >
                    <span className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary/0 via-primary to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-r-full" />
                    <div className="flex items-center justify-center">
                      <span className="text-xs font-mono text-muted-foreground tabular-nums">{String(rule.order || index + 1).padStart(3, "0")}</span>
                    </div>
                    <div className="flex items-center justify-center">
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border shadow-sm transition-all duration-200 group-hover:scale-105", rule.type === "blocklist" ? "bg-gradient-to-r from-red-500/25 to-red-500/15 text-red-600 dark:text-red-400 border-red-500/30" : "bg-gradient-to-r from-primary/25 to-primary/15 text-primary border-primary/30")}>
                        {rule.type}
                      </span>
                    </div>
                    <div className="flex items-center justify-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-gradient-to-r from-muted/60 to-muted/40 text-foreground border border-border/50 shadow-sm">{rule.mode}</span>
                    </div>
                    <div className="flex items-center min-w-0 pr-2">
                      <div className="font-mono text-sm text-foreground truncate font-medium group-hover:text-primary transition-colors duration-200" title={rule.content}>
                        {rule.content}
                      </div>
                    </div>
                    <div className="relative flex h-9 items-center justify-end">
                      <div className="absolute right-9 flex items-center gap-1 opacity-0 pointer-events-none translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:translate-x-0">
                        <button
                          type="button"
                          aria-label="编辑规则"
                          title="编辑规则"
                          onClick={() => setEditingRule(rule)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="删除规则"
                          title="删除规则"
                          onClick={() => void deleteRule(rule)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        draggable
                        aria-label="拖拽排序"
                        title="拖拽排序"
                        onDragStart={(event) => {
                          setDraggingRuleKey(ruleKey);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", ruleKey);
                        }}
                        onDragEnd={() => {
                          setDraggingRuleKey("");
                          setDragOverRuleKey("");
                        }}
                        className="absolute right-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-dashed border-border/60 text-muted-foreground/80 shadow-sm cursor-grab transition-all duration-200 hover:text-primary hover:bg-primary/10 hover:shadow-md active:cursor-grabbing group-hover:border-primary/40 group-hover:bg-primary/5 group-hover:text-primary"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  );
                })}
                {!loading && rules.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无规则</div>}
              </div>
            </div>
          </div>
        )}

        {activeView === "adblock" && (
          <AdblockView
            onToast={showToast}
            lists={adblockRules}
            onToggle={toggleRuleSet}
            onUpdate={updateRuleSet}
            onDelete={deleteRuleSet}
            onEdit={editRuleSet}
            onAdd={addRuleSet}
            onUpdateAll={updateAllRuleSets}
          />
        )}
        {activeView === "routing" && (
          <RoutingView
            onToast={showToast}
            lists={routingRules}
            onToggle={toggleRuleSet}
            onUpdate={updateRuleSet}
            onDelete={deleteRuleSet}
            onEdit={editRuleSet}
            onAdd={addRuleSet}
            onUpdateAll={updateAllRuleSets}
          />
        )}
      </div>

      {modal === "add" && category && (
        <AddRuleModal categoryId={category.id} categoryLabel={category.label} onClose={() => setModal(null)} onAdd={handleAdd} />
      )}
      {modal === "import" && category && (
        <ImportRulesModal categoryLabel={category.label} onClose={() => setModal(null)} onImport={handleImport} />
      )}
      {modal === "clear" && category && (
        <ClearConfirmModal categoryLabel={category.label} onClose={() => setModal(null)} onConfirm={handleClear} />
      )}
      {editingRule && (
        <EditRuleModal
          rule={editingRule}
          onClose={() => setEditingRule(null)}
          onSave={(mode, value) => void editRule(editingRule, mode, value)}
        />
      )}
      {ruleSetModal && (
        <AddRuleSetModal
          sourceType={ruleSetModal}
          typeOptions={ruleSetModal === "srs" ? routingRuleSetTypes : adguardRuleSetTypes}
          onClose={() => setRuleSetModal(null)}
          onAdd={(values) => void createRuleSet(ruleSetModal, values)}
        />
      )}
      <ToastStack toasts={toasts} />
    </AppShell>
  );
}
