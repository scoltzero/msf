"use client";

import { useEffect, useState } from "react";
import {
  X,
  Check,
  Pencil,
  Info,
  Upload,
  TriangleAlert,
  CheckCircle2,
} from "lucide-react";

/** Shared centered modal backdrop + card frame (matches site's rounded-3xl gradient dialog). */
function ModalShell({
  onClose,
  children,
  className = "max-w-2xl",
}: {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div
        className={`relative w-full ${className} bg-gradient-to-br from-background via-background to-muted/20 rounded-3xl border-2 border-border/50 shadow-2xl max-h-[90vh] overflow-auto animate-scale-in`}
      >
        {children}
      </div>
    </div>
  );
}

function DialogHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="relative p-6 border-b-2 border-border/30 bg-gradient-to-r from-primary/10 via-muted/30 to-transparent overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary/20 to-transparent rounded-bl-full" />
      <div className="relative">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground mt-2 flex items-center gap-2">
          {icon}
          {subtitle}
        </p>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-4 py-3 rounded-xl border-2 border-border/50 bg-gradient-to-r from-background to-muted/20 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm transition-all shadow-sm hover:shadow-md";

const cancelCls =
  "px-6 py-3 rounded-xl border-2 border-border/50 text-foreground hover:bg-accent hover:border-border transition-all duration-200 flex items-center gap-2 font-medium";
const primaryCls =
  "px-6 py-3 rounded-xl bg-gradient-to-r from-primary via-primary to-primary/90 text-primary-foreground hover:from-primary/90 hover:to-primary/80 transition-all duration-300 flex items-center gap-2 font-bold shadow-lg shadow-primary/30 hover:shadow-xl hover:scale-105 active:scale-95";

const MODE_OPTIONS = [
  { value: "domain", label: "域匹配 domain" },
  { value: "full", label: "完整匹配 full" },
  { value: "keyword", label: "关键词 keyword" },
  { value: "regexp", label: "正则 regexp" },
];

function rulePatternFor(mode: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(domain|full|keyword|regexp):/.test(trimmed)) return trimmed;
  return `${mode}:${trimmed}`;
}

export type RuleSetTypeOption = {
  value: string;
  label: string;
};

export type RuleSetFormValues = {
  name: string;
  type: string;
  url: string;
  files?: string;
  autoUpdate: boolean;
  updateIntervalHours: number;
};

function sanitizeRuleFileName(value: string) {
  const source = value.trim();
  if (!source) return "rules.srs";
  const fallback = source.replace(/^https?:\/\//, "").split(/[/?#]/)[0] || source;
  const base = fallback
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/\.[a-z0-9]+$/i, "");
  const safe = (base || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._@!-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safe || "rules"}.srs`;
}

function defaultRuleSetFile(name: string, url: string) {
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split("/").filter(Boolean).pop();
    if (file) return `srs/${file.endsWith(".srs") ? file : sanitizeRuleFileName(file)}`;
  } catch {
    // fall back to name based path
  }
  return `srs/${sanitizeRuleFileName(name)}`;
}

const sourceInputCls =
  "w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/55 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background focus:border-primary transition-colors";

export function AddRuleSetModal({
  sourceType,
  typeOptions,
  onClose,
  onAdd,
}: {
  sourceType: "adguard" | "srs";
  typeOptions: RuleSetTypeOption[];
  onClose: () => void;
  onAdd: (values: RuleSetFormValues) => void;
}) {
  const firstType = typeOptions[0]?.value || (sourceType === "adguard" ? "adguard" : "geositecn");
  const [name, setName] = useState("");
  const [type, setType] = useState(firstType);
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState("srs/rules.srs");
  const [filesTouched, setFilesTouched] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [updateInterval, setUpdateInterval] = useState("24");

  const title = sourceType === "srs" ? "添加在线分流规则" : "添加广告拦截规则";
  const selectedTypeLabel = typeOptions.find((item) => item.value === type)?.label || type;

  const updateUrl = (nextUrl: string) => {
    setUrl(nextUrl);
    if (!filesTouched && sourceType === "srs") {
      setFiles(defaultRuleSetFile(name, nextUrl));
    }
  };

  const updateName = (nextName: string) => {
    setName(nextName);
    if (!filesTouched && sourceType === "srs" && !url.trim()) {
      setFiles(defaultRuleSetFile(nextName, ""));
    }
  };

  const canSubmit = Boolean(name.trim() && url.trim() && type.trim());

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-[680px] max-h-[92vh] overflow-hidden rounded-lg border border-slate-900/70 bg-background shadow-2xl animate-scale-in">
        <div className="relative border-b border-slate-900/70 bg-gradient-to-r from-blue-50 via-sky-50 to-cyan-50 px-5 py-5 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute right-5 top-5 rounded-md p-1 text-foreground/80 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="text-2xl font-bold tracking-tight text-blue-600">{title}</h2>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-lg leading-none text-muted-foreground">＋</span>
            添加新的 {selectedTypeLabel} 规则
          </p>
        </div>

        <div className="max-h-[calc(92vh-168px)] overflow-y-auto px-5 py-5">
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">规则名称</label>
              <input
                value={name}
                onChange={(event) => updateName(event.target.value)}
                placeholder="例如: my-custom-rule"
                className={sourceInputCls}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">规则类型</label>
              <select
                value={type}
                onChange={(event) => setType(event.target.value)}
                className={`${sourceInputCls} pr-9`}
                autoFocus
              >
                {typeOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">选择匹配方式</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">清单网址(URL)</label>
              <input
                value={url}
                onChange={(event) => updateUrl(event.target.value)}
                placeholder={sourceType === "srs" ? "https://example.com/rules.srs" : "https://example.com/rules.txt"}
                className={sourceInputCls}
              />
              <p className="text-xs text-muted-foreground">
                {sourceType === "srs" ? "目前只支持 SRS 格式的规则文件" : "目前支持文本格式的规则文件"}
              </p>
            </div>

            {sourceType === "srs" && (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">本地文件路径</label>
                <input
                  value={files}
                  onChange={(event) => {
                    setFilesTouched(true);
                    setFiles(event.target.value);
                  }}
                  placeholder="srs/rules.srs"
                  className={sourceInputCls}
                />
                <p className="text-xs text-muted-foreground">根据 URL 自动生成，也可手动修改</p>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/20 px-4 py-4">
              <label className="inline-flex items-center gap-3 text-sm font-semibold text-foreground">
                <input
                  type="checkbox"
                  checked={autoUpdate}
                  onChange={(event) => setAutoUpdate(event.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                自动更新
              </label>
              <div className="mt-4 flex items-center gap-3 text-sm">
                <span className="font-semibold text-foreground">更新间隔:</span>
                <input
                  type="number"
                  min={1}
                  value={updateInterval}
                  onChange={(event) => setUpdateInterval(event.target.value)}
                  className="h-10 w-24 rounded-lg border border-border bg-background px-3 text-center text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background focus:border-primary"
                />
                <span className="text-muted-foreground">小时</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-900/70 bg-background px-5 py-5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            取消
          </button>
          <button
            type="button"
            aria-disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) return;
              onAdd({
                name: name.trim(),
                type,
                url: url.trim(),
                files: sourceType === "srs" ? files.trim() || defaultRuleSetFile(name, url) : undefined,
                autoUpdate,
                updateIntervalHours: Math.max(1, Number(updateInterval) || 24),
              });
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700 aria-disabled:cursor-not-allowed"
          >
            <Check className="h-4 w-4" />
            添加
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddRuleModal({
  categoryId,
  categoryLabel,
  onClose,
  onAdd,
}: {
  categoryId: string;
  categoryLabel: string;
  onClose: () => void;
  onAdd: (pattern: string) => void;
}) {
  const [mode, setMode] = useState("domain");
  const [value, setValue] = useState("");
  const [target, setTarget] = useState("");
  const normalizedCategory = categoryId === "rewrite" ? "redirect" : categoryId;
  const isDDNS = normalizedCategory === "ddnslist";
  const isDirectIP = normalizedCategory === "direct_ip";
  const isRedirect = normalizedCategory === "redirect";
  const canSubmit = isRedirect ? Boolean(value.trim() && target.trim()) : Boolean(value.trim());

  const submit = () => {
    if (!canSubmit) return;
    if (isRedirect) {
      onAdd(`${rulePatternFor(mode, value)} ${target.trim()}`);
      return;
    }
    onAdd(isDDNS || isDirectIP ? value.trim() : rulePatternFor(mode, value));
  };

  const labelCls = "text-sm font-bold text-foreground mb-3 flex items-center gap-2";
  const hintCls = "text-xs text-muted-foreground mt-2 ml-1";
  const exampleItemCls = "px-3 py-2 rounded-lg bg-background/60";
  const buttonCls = primaryCls;

  return (
    <ModalShell onClose={onClose} className="max-w-[600px]">
      <DialogHeader
        title="添加规则"
        icon={<span className="text-primary">＋</span>}
        subtitle={<>添加新的 {categoryLabel} 规则</>}
      />
      <div className="p-6 space-y-5">
        {isDDNS && (
          <>
            <div>
              <label className={labelCls}>
                <span className="h-1 w-1 rounded-full bg-primary" />
                域名
              </label>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="例如: example.com"
                className={inputCls}
                autoFocus
              />
              <p className={hintCls}>直接输入域名即可</p>
            </div>
            <div className="bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl p-5 border-2 border-border/30 shadow-inner">
              <label className={labelCls}>
                <Info className="h-4 w-4 text-primary" />
                示例
              </label>
              <div className="space-y-2 text-xs text-muted-foreground font-mono">
                {["example.com", "ddns.example.com"].map((ex) => (
                  <div key={ex} className={exampleItemCls}>
                    • {ex}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {isDirectIP && (
          <>
            <div>
              <label className={labelCls}>
                <span className="h-1 w-1 rounded-full bg-primary" />
                IP段
              </label>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="例如: 17.0.0.0/8"
                className={inputCls}
                autoFocus
              />
              <p className={hintCls}>输入CIDR格式的IP段</p>
            </div>
            <div className="bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl p-5 border-2 border-border/30 shadow-inner">
              <label className={labelCls}>
                <Info className="h-4 w-4 text-primary" />
                说明
              </label>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className={exampleItemCls}>
                  不在任何域名清单中的域名解析后的IP属于此IP清单时，此域名将被归入直连域名。
                </div>
                <div className={`${exampleItemCls} font-mono`}>• 17.0.0.0/8（苹果公司IP段）</div>
              </div>
            </div>
          </>
        )}

        {isRedirect && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label className={labelCls}>
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  匹配规则
                </label>
                <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls} autoFocus>
                  {MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className={hintCls}>可选匹配方式</p>
              </div>
              <div>
                <label className={labelCls}>
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  原域名
                </label>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="例如: example.com"
                  className={inputCls}
                />
                <p className={hintCls}>需要重定向的域名</p>
              </div>
              <div>
                <label className={labelCls}>
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  重定向目标
                </label>
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="例如: 1.2.3.4"
                  className={inputCls}
                />
                <p className={hintCls}>IP地址或域名</p>
              </div>
            </div>
            <div className="bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl p-5 border-2 border-border/30 shadow-inner">
              <label className={labelCls}>
                <Info className="h-4 w-4 text-primary" />
                示例
              </label>
              <div className="space-y-2 text-xs text-muted-foreground font-mono">
                {[
                  "原域名: example.com，目标: 1.2.3.4（重定向到IP）",
                  "原域名: test.com，目标: example.com（重定向到域名）",
                  "匹配: domain，原域名: sub.example.com，目标: 1.2.3.4（含子域名）",
                ].map((ex) => (
                  <div key={ex} className={exampleItemCls}>
                    • {ex}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {!isDDNS && !isDirectIP && !isRedirect && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className={labelCls}>
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  匹配规则
                </label>
                <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls} autoFocus>
                  {MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className={hintCls}>选择匹配方式</p>
              </div>
              <div>
                <label className={labelCls}>
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  规则值
                </label>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="例如: example.com"
                  className={inputCls}
                />
                <p className={hintCls}>无需包含前缀，前缀由匹配规则选择生成</p>
              </div>
            </div>
            <div className="bg-gradient-to-br from-muted/40 to-muted/20 rounded-xl p-5 border-2 border-border/30 shadow-inner">
              <label className={labelCls}>
                <Info className="h-4 w-4 text-primary" />
                示例
              </label>
              <div className="space-y-2 text-xs text-muted-foreground font-mono">
                {[
                  "domain:example.com（含子域名）",
                  "full:www.example.com（仅此域名）",
                  "keyword:google（包含关键字）",
                  "regexp:.+\\.example\\.com$（正则）",
                ].map((ex) => (
                  <div key={ex} className={exampleItemCls}>
                    • {ex}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <div className="p-6 border-t-2 border-border/30 flex justify-end gap-3 bg-gradient-to-r from-muted/20 to-transparent">
        <button onClick={onClose} className={cancelCls}>
          <X className="h-4 w-4" />取消
        </button>
        <button
          aria-disabled={!canSubmit}
          onClick={submit}
          className={buttonCls}
        >
          <Check className="h-4 w-4" />添加
        </button>
      </div>
    </ModalShell>
  );
}

export function EditRuleModal({
  rule,
  onClose,
  onSave,
}: {
  rule: {
    mode: string;
    content: string;
    pattern?: string;
  };
  onClose: () => void;
  onSave: (mode: string, value: string) => void;
}) {
  const initialMode = rule.mode === "默认" ? "domain" : rule.mode;
  const [mode, setMode] = useState(initialMode);
  const [value, setValue] = useState(rule.content);
  const originalRule = rule.pattern || `${initialMode}:${rule.content}`;

  return (
    <ModalShell onClose={onClose} className="max-w-[600px]">
      <DialogHeader
        title="编辑规则"
        icon={<Pencil className="h-4 w-4 text-muted-foreground" />}
        subtitle="修改规则内容"
      />
      <div className="p-6 space-y-5">
        <div>
          <label className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <span className="text-muted-foreground">·</span>
            原规则
          </label>
          <input
            value={originalRule}
            readOnly
            className={`${inputCls} font-mono text-muted-foreground bg-muted/30 cursor-default`}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-primary" />
              匹配规则
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className={inputCls}
            >
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-primary" />
              规则值
            </label>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
      </div>
      <div className="p-6 border-t-2 border-border/30 flex justify-end gap-3 bg-gradient-to-r from-muted/20 to-transparent">
        <button onClick={onClose} className={cancelCls}>
          <X className="h-4 w-4" />取消
        </button>
        <button
          onClick={() => value.trim() && onSave(mode, value.trim())}
          className={primaryCls}
        >
          <Check className="h-4 w-4" />保存
        </button>
      </div>
    </ModalShell>
  );
}

export function ImportRulesModal({
  categoryLabel,
  onClose,
  onImport,
}: {
  categoryLabel: string;
  onClose: () => void;
  onImport: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <ModalShell onClose={onClose}>
      <DialogHeader
        title="导入规则"
        icon={<Upload className="h-4 w-4 text-primary" />}
        subtitle={<>导入 {categoryLabel} 规则（将覆盖现有规则）</>}
      />
      <div className="p-6">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴规则内容，每行一条规则..."
          rows={12}
          className={`${inputCls} resize-none font-mono`}
        />
      </div>
      <div className="p-6 border-t-2 border-border/30 flex justify-end gap-3 bg-gradient-to-r from-muted/20 to-transparent">
        <button onClick={onClose} className={cancelCls}>
          <X className="h-4 w-4" />取消
        </button>
        <button onClick={() => onImport(text)} className={primaryCls}>
          <Check className="h-4 w-4" />导入规则
        </button>
      </div>
    </ModalShell>
  );
}

export function ClearConfirmModal({
  categoryLabel,
  onClose,
  onConfirm,
}: {
  categoryLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell onClose={onClose} className="max-w-md">
      <div className="p-6">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-100 to-orange-50 dark:from-orange-900/40 dark:to-orange-900/20 flex items-center justify-center">
            <TriangleAlert className="h-8 w-8 text-orange-500" />
          </div>
        </div>
        <h3 className="text-lg font-semibold text-foreground text-center mb-2">
          清空确认
        </h3>
        <p className="text-sm text-muted-foreground text-center">
          确定清空「{categoryLabel}」的所有规则？此操作不可恢复。
        </p>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 text-sm font-medium bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-lg hover:from-orange-600 hover:to-orange-700 transition-colors"
          >
            确认
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export interface ToastItem {
  id: number;
  message: string;
}

export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="fixed top-20 right-4 z-[110] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl glass-effect-strong shadow-apple-lg border border-border/30 text-sm font-medium text-foreground animate-fade-in"
        >
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          {t.message}
        </div>
      ))}
    </div>
  );
}
