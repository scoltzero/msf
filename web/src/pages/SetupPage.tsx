import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Cpu,
  DownloadCloud,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Languages,
  Loader2,
  Mail,
  Monitor,
  Moon,
  Network,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  Upload,
  UserRound,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import GlassSurface from "@/components/react-bits/GlassSurface";
import { SceneBackdrop } from "@/components/liquid-glass/SceneBackdrop";
import { applyTheme, getInitialTheme, prefersDarkMode, themeOptions, type ThemeMode } from "@/lib/appearance";
import { useLanguage, type AppLanguage } from "@/lib/localization";
import { validateAllSetupSteps, validateSetupStep, type SetupValidationIssue } from "@/pages/setup/setup-validation";
import "@/pages/setup/setup-page.css";

interface NetworkInterface {
  name: string;
  ip?: string;
  primary_ip?: string;
  is_loopback?: boolean;
  is_up?: boolean;
  is_usable?: boolean;
  is_default?: boolean;
  recommended?: boolean;
  speed?: string | number;
}

interface SetupSystemInfo {
  system?: {
    os?: string;
    arch?: string;
    hostname?: string;
  };
  cpu?: {
    model?: string;
    cores?: number;
    amd64v3_status?: string;
    supportsAMD64v3?: boolean;
  };
}

interface PrivilegeInfo {
  is_root?: boolean;
  message?: string;
  runtime?: {
    docker?: boolean;
    docker_network_mode?: string;
    macos?: boolean;
  };
}

interface SubscriptionRow {
  tag: string;
  url: string;
}

interface SetupPortListener {
  port?: number;
  protocol?: string;
  address?: string;
  pid?: number;
  process?: string;
  source?: string;
  error?: string;
}

interface SetupPortCheck {
  port: number;
  protocol: string;
  service: string;
  status: string;
  message?: string;
  listeners?: SetupPortListener[];
}

interface SetupPreflight {
  success?: boolean;
  effective_proxy_mode?: string;
  dns53?: {
    status?: string;
    message?: string;
    reason?: string;
    probe_error?: string;
    remediated?: boolean;
    can_remediate?: boolean;
    blockers?: SetupPortListener[];
  };
  timezone?: {
    current?: string;
    target?: string;
    needs_change?: boolean;
    valid?: boolean;
    message?: string;
  };
  tun?: {
    required?: boolean;
    available?: boolean;
    device?: string;
    net_admin?: boolean;
    net_raw?: boolean;
    network_mode?: string;
    message?: string;
  };
  reserved_ports?: SetupPortCheck[];
  blocking?: boolean;
  warnings?: string[];
  errors?: string[];
}

const defaultForm = {
  username: "",
  password: "",
  confirmPassword: "",
  email: "",
  timezone: "Asia/Shanghai",
  webPort: "7788",
  enableHttps: false,
  selected_interface: "",
  amd64v3_enabled: false,
  mihomo_core_type: "meta",
  auto_set_dns: true,
  dns_on: "127.0.0.1",
  dns_off: "223.5.5.5",
  enableIPv6: true,
  fakeIPRangeV4: "28.0.0.0/8",
  fakeIPRangeV6: "f2b0::/18",
  linux_proxy_mode: "nft",
  nft_proxy_policy: "direct_default",
  proxyCore: "mihomo",
  mosdnsEnabled: true,
  subscription_urls: "",
  mihomo_proxies: "",
  github_proxy_enabled: false,
  github_https_proxy: "",
  github_http_proxy: "",
  github_socks5_proxy: "",
  github_accelerator_enabled: false,
  github_accelerator_url: "",
};

type SetupForm = typeof defaultForm;

type SetupDownloadStatus = "pending" | "running" | "completed" | "failed" | "skipped";
type SetupDownloadIntroStage = 0 | 1 | 2;

interface SetupDownloadStep {
  component: string;
  title: string;
  description: string;
  status: SetupDownloadStatus;
  progress: number;
  message: string;
}

interface SetupDownloadEvent {
  status?: string;
  progress?: number;
  message?: string;
}

const steps = [
  { title: "账户与系统", description: "管理入口", icon: UserRound },
  { title: "网络与 DNS", description: "网络参数", icon: Network },
  { title: "组件与代理", description: "运行方式", icon: SlidersHorizontal },
  { title: "检查并安装", description: "启动系统", icon: CheckCircle2 },
];

const inputClass =
  "msf-setup-control h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60";

const downloadComponentMeta: Record<string, { title: string; description: string }> = {
  mosdns: { title: "MosDNS", description: "下载并安装 DNS 分流核心" },
  mihomo: { title: "Mihomo", description: "下载代理核心并安装控制面板" },
  __activate: { title: "启动服务", description: "启动 MosDNS 与代理核心服务" },
};

function normalizeDownloadComponents(value: unknown, form?: SetupForm) {
  const raw = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  const out: string[] = [];
  const add = (item: unknown) => {
    const component = String(item || "").trim().toLowerCase();
    if (!component || component === "singbox" || component === "sing-box") return;
    const normalized = component === "zashboard" || component === "ui" ? "mihomo" : component;
    if ((normalized === "mosdns" || normalized === "mihomo") && !out.includes(normalized)) out.push(normalized);
  };
  raw.forEach(add);
  if (out.length === 0 && form) {
    if (form.mosdnsEnabled) add("mosdns");
    if (form.proxyCore === "mihomo") add("mihomo");
  }
  return out;
}

function createDownloadSteps(components: string[]): SetupDownloadStep[] {
  return components.map((component) => {
    const meta = downloadComponentMeta[component] || { title: component, description: "下载并安装组件" };
    return {
      component,
      title: meta.title,
      description: meta.description,
      status: "pending",
      progress: 0,
      message: "等待下载",
    };
  });
}

function streamSetupDownload(component: string, onEvent: (event: SetupDownloadEvent) => void) {
  return new Promise<void>((resolve, reject) => {
    const source = new EventSource(`/api/v1/setup/download/${encodeURIComponent(component)}?skip_if_exists=1`);
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      source.close();
      if (err) reject(err);
      else resolve();
    };
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as SetupDownloadEvent;
        onEvent(payload);
        const status = String(payload.status || "").toLowerCase();
        if (status === "completed" || status === "skipped") finish();
        if (status === "failed") finish(new Error(payload.message || `${component} 下载失败`));
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    };
    source.onerror = () => finish(new Error(`${downloadComponentMeta[component]?.title || component} 下载连接中断`));
  });
}

async function uploadMosDNSBundle(file: File, onEvent: (event: SetupDownloadEvent) => void) {
  onEvent({ status: "running", progress: 5, message: "正在上传 MosDNS ZIP" });
  const body = new FormData();
  body.append("file", file, file.name);
  await api("/api/v1/setup/mosdns/install", { method: "POST", body, skipAuth: true });
  onEvent({ status: "completed", progress: 100, message: "MosDNS 与流量代理已安装" });
}

async function installMosDNSBundleFromURL(url: string, onEvent: (event: SetupDownloadEvent) => void) {
  onEvent({ status: "running", progress: 5, message: "正在下载 MosDNS ZIP" });
  await api("/api/v1/setup/mosdns/install", {
    method: "POST",
    body: JSON.stringify({ url }),
    skipAuth: true,
  });
  onEvent({ status: "completed", progress: 100, message: "MosDNS 与流量代理已安装" });
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function networkRows(payload: any): NetworkInterface[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.interfaces)) return payload.interfaces;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function occupiedReservedPorts(preflight: SetupPreflight | null) {
  return (preflight?.reserved_ports || []).filter((item) => item.status === "occupied");
}

function listenerText(listener: SetupPortListener) {
  const owner = listener.process ? `${listener.process}${listener.pid ? `(${listener.pid})` : ""}` : listener.pid ? `PID ${listener.pid}` : "未知进程";
  const source = listener.source ? `来源 ${listener.source}` : "";
  const error = listener.error ? `错误 ${listener.error}` : "";
  return [owner, listener.address, source, error].filter(Boolean).join(" · ");
}

function preflightDNSLabel(status?: string) {
  if (status === "ok") return "可用";
  if (status === "remediated") return "已自动修复";
  if (status === "warning") return "需确认";
  if (status === "blocked") return "阻断";
  return "未知";
}

function preflightDNSClass(status?: string) {
  if (status === "blocked") return "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300";
  if (status === "warning") return "border-yellow-500/25 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300";
  return "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-300";
}

function preflightDNSReasonLabel(reason?: string) {
  if (reason === "occupied") return "真实监听占用";
  if (reason === "permission_denied") return "权限或运行环境限制";
  if (reason === "probe_error") return "探测异常";
  if (reason === "systemd_resolved_stub") return "systemd-resolved DNS stub";
  if (reason === "free") return "未发现占用";
  return reason || "";
}

function preflightDNSDiagnostics(dns53?: SetupPreflight["dns53"]) {
  const reason = preflightDNSReasonLabel(dns53?.reason);
  return [reason ? `原因：${reason}` : "", dns53?.probe_error ? `探测错误：${dns53.probe_error}` : ""].filter(Boolean);
}

function serializeSubscriptions(rows: SubscriptionRow[]) {
  return rows
    .map((row) => {
      const tag = row.tag.trim();
      const url = row.url.trim();
      if (!url) return "";
      return tag ? `${tag}|${url}` : url;
    })
    .filter(Boolean)
    .join("\n");
}

function Field({
  label,
  children,
  hint,
  error,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-2 text-sm font-medium text-foreground", className)}>
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs leading-5 text-muted-foreground">{hint}</span>}
      {error && <span className="text-xs font-medium leading-5 text-red-600 dark:text-red-300">{error}</span>}
    </label>
  );
}

function SetupPasswordInput({
  name,
  value,
  placeholder,
  show,
  invalid,
  describedBy,
  onChange,
  onToggle,
}: {
  name: string;
  value: string;
  placeholder: string;
  show: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  onToggle: () => void;
}) {
  const label = show ? "隐藏密码" : "显示密码";

  return (
    <div className="relative">
      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        className={cn(inputClass, "pl-9 pr-11", invalid && "msf-setup-field-error")}
        name={name}
        data-setup-field={name}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onToggle}
        className="absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function SetupPageButton({
  children,
  disabled,
  variant = "secondary",
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "msf-setup-button inline-flex h-9 min-w-[80px] touch-manipulation items-center justify-center gap-2 rounded-[10px] border px-4 text-sm font-medium transition-[transform,color,background-color,border-color,box-shadow,opacity] focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed",
        variant === "primary" ? "msf-setup-button--primary" : "msf-setup-button--secondary"
      )}
    >
      {children}
    </button>
  );
}

function SetupStepper({
  current,
  furthest,
  onStepClick,
}: {
  current: number;
  furthest: number;
  onStepClick: (step: number) => void;
}) {
  const { isEnglish } = useLanguage();
  const englishStepTitles = ["Account & System", "Network & DNS", "Components & Proxy", "Review & Install"];

  return (
    <nav aria-label={isEnglish ? "Setup Steps" : "初始化步骤"} className="msf-setup-stepper sticky top-0 z-30 w-full border-b border-border/35 px-4 pb-5 pt-5 sm:px-8 sm:pb-6 sm:pt-6">
      <ol className="flex items-start justify-between">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const active = index === current;
          const done = index < current;
          const last = index === steps.length - 1;
          return (
            <li key={step.title} className="flex min-w-0 flex-1 items-start">
              <button
                type="button"
                onClick={() => onStepClick(index)}
                disabled={index > furthest}
                aria-current={active ? "step" : undefined}
                aria-label={`${index + 1}. ${isEnglish ? englishStepTitles[index] : step.title}${active ? (isEnglish ? ", current step" : "，当前步骤") : done ? (isEnglish ? ", completed" : "，已完成") : ""}`}
                className="flex min-w-0 flex-1 touch-manipulation flex-col items-center border-0 bg-transparent p-0 text-center shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-55 hover:shadow-none"
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-[transform,color,background-color,box-shadow] sm:h-10 sm:w-10",
                    active && "bg-primary text-primary-foreground ring-4 ring-primary/20 shadow-lg shadow-primary/25",
                    done && "bg-primary text-primary-foreground",
                    !active && !done && "bg-muted text-muted-foreground"
                  )}
                >
                  {done ? <Check className="h-5 w-5" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "mt-2 w-full truncate px-1 text-xs font-semibold sm:text-sm",
                    active ? "text-foreground" : done ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {step.title}
                </span>
                <span className="mt-1 hidden w-full truncate px-1 text-xs text-muted-foreground md:block">
                  {step.description}
                </span>
              </button>
              {!last && (
                <span
                  className={cn(
                    "mx-2 mt-5 h-px max-w-10 flex-1 transition-colors",
                    done ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SetupCard({
  children,
  footer,
}: {
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <section className="rounded-b-2xl border-t border-border/70 bg-transparent">
      <div className="msf-setup-content min-h-[28rem] px-4 py-6 sm:px-7 lg:px-9 lg:py-8">{children}</div>
      <div className="msf-setup-footer sticky bottom-0 z-20 flex min-h-[66px] items-center justify-between border-t border-border/70 px-4 py-3 sm:px-7">{footer}</div>
    </section>
  );
}

function StepIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Icon className="h-6 w-6" />
    </div>
  );
}

function SetupSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="msf-setup-section rounded-[16px] border border-border/65 p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
  badge,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span>{title}</span>
          {badge}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <ToggleSwitch checked={checked} disabled={disabled} onChange={onChange} label={title} />
    </div>
  );
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "msf-setup-toggle relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent p-0 transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted"
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

function CheckOption({
  name,
  title,
  description,
  checked,
  onChange,
  children,
}: {
  name?: string;
  title: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="group flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card/50 p-3 transition-colors hover:border-primary/40">
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <input
            name={name}
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            className="peer sr-only"
          />
          <span className="flex h-4 w-4 items-center justify-center rounded border-2 border-border bg-background transition-[color,background-color,border-color] peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-checked:border-primary peer-checked:bg-primary group-hover:border-primary/50">
            {checked && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-foreground">{title}</span>
          {description && <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">{description}</span>}
        </span>
      </label>
      {checked && children}
    </div>
  );
}

function ChoiceCard({
  title,
  description,
  selected,
  disabled,
  badge,
  onClick,
}: {
  title: string;
  description: string;
  selected: boolean;
  disabled?: boolean;
  badge?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex min-h-[92px] w-full items-start gap-3 rounded-xl border p-4 text-left transition-[transform,color,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border bg-background hover:border-primary/30"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-transparent"
        )}
      >
        <Check className="h-3 w-3" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {title}
          {badge}
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warning" | "success" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "warning" && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
        tone === "success" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
      )}
    >
      {children}
    </span>
  );
}

function SetupDownloadView({
  steps: downloadSteps,
  introStage,
  status,
  error,
  failedComponent,
  busy,
  onRetry,
  onManual,
}: {
  steps: SetupDownloadStep[];
  introStage: SetupDownloadIntroStage;
  status: "running" | "completed" | "failed";
  error: string;
  failedComponent: string;
  busy: boolean;
  onRetry: () => void;
  onManual: () => void;
}) {
  type VisualStep = {
    key: string;
    title: string;
    message?: string;
    status: SetupDownloadStatus;
    progress?: number;
    icon: LucideIcon;
  };

  const introComplete = introStage >= 2;
  const visibleDownloadSteps = introComplete
    ? downloadSteps
    : downloadSteps.map((item) => ({ ...item, status: "pending" as SetupDownloadStatus, progress: 0, message: "" }));
  const downloadsDone =
    introComplete && visibleDownloadSteps.every((item) => item.status === "completed" || item.status === "skipped");
  const visualSteps: VisualStep[] = [
    {
      key: "account",
      title: "创建管理员账户",
      message: introStage === 0 ? "正在保存管理员账户" : "",
      status: introStage === 0 ? "running" : "completed",
      icon: UserRound,
    },
    {
      key: "system",
      title: "配置系统设置",
      message: introStage === 1 ? "正在写入基础配置" : "",
      status: introStage === 0 ? "pending" : introStage === 1 ? "running" : "completed",
      icon: Settings2,
    },
    ...visibleDownloadSteps.map((item) => ({
      key: item.component,
      title: `下载 ${item.title}`,
      message: item.status === "pending" ? "" : item.message,
      status: item.status,
      progress: item.progress,
      icon: DownloadCloud,
    })),
    {
      key: "__activate",
      title: "启动服务",
      message: failedComponent === "__activate" ? error : "",
      status:
        failedComponent === "__activate"
          ? "failed"
          : status === "completed"
            ? "completed"
            : downloadsDone && status === "running"
              ? "running"
              : "pending",
      icon: Globe2,
    },
    {
      key: "__finalize",
      title: "完成初始化配置",
      message: failedComponent === "__finalize" ? error : "",
      status: failedComponent === "__finalize" ? "failed" : status === "completed" ? "completed" : "pending",
      icon: ShieldCheck,
    },
  ];
  const completed = visualSteps.filter((item) => item.status === "completed" || item.status === "skipped").length;
  const overall = Math.round((completed / Math.max(visualSteps.length, 1)) * 100);
  const failedTitle = downloadComponentMeta[failedComponent]?.title || failedComponent || "-";
  return (
    <div className="gary-public-page msf-setup-page fixed inset-0 z-50 flex min-h-[100dvh] overflow-y-auto px-4 py-[max(2rem,env(safe-area-inset-top))] text-foreground sm:items-center sm:justify-center sm:py-10">
      <SceneBackdrop scene="neutral" />
      <div role="status" aria-live="polite" aria-atomic="false" className="gary-public-card relative z-[1] my-auto w-full max-w-md p-5 sm:p-6">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl" />
              <img src="/logo/logo-square.png" alt="MSF" className="relative z-10 h-16 w-16" />
            </div>
          </div>
          <h2 className="mb-2 text-2xl font-bold tracking-normal text-foreground">
            {status === "failed" ? "初始化失败" : "正在初始化系统"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {status === "failed" ? "核心组件未安装完成，请重试或稍后手动下载。" : "请稍候，我们正在为您配置 MSF 管理平台…"}
          </p>
        </div>

        <div className="mb-8 space-y-3">
          {visualSteps.map((item) => {
            const Icon = item.icon;
            const isCompleted = item.status === "completed" || item.status === "skipped";
            const isRunning = item.status === "running";
            const isFailed = item.status === "failed";
            const isPending = item.status === "pending";

            return (
              <div
                key={item.key}
                className={cn(
                  "flex items-start gap-3 rounded-lg p-3 transition-[opacity,color,background-color,border-color] duration-300",
                  isRunning && "border border-primary/20 bg-primary/10",
                  isCompleted && "bg-muted/50",
                  isFailed && "border border-red-500/20 bg-red-500/10",
                  isPending && "opacity-40"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-[color,background-color] duration-300",
                    isCompleted && "bg-green-500 text-white",
                    isRunning && "bg-primary text-primary-foreground",
                    isFailed && "bg-red-500 text-white",
                    isPending && "bg-muted text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isFailed ? (
                    <AlertCircle className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className={cn(
                        "text-sm font-medium transition-colors",
                        isRunning && "text-foreground",
                        isCompleted && "text-muted-foreground",
                        isFailed && "text-red-500",
                        isPending && "text-muted-foreground"
                      )}
                    >
                      {item.title}
                    </p>
                    {isFailed && <Badge tone="warning">失败</Badge>}
                  </div>

                  {item.message && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {item.key === "__activate" || item.key === "__finalize" ? item.message : `${item.title.replace(/^下载\s+/, "")}: ${item.message}`}
                    </p>
                  )}

                  {item.key !== "__activate" && item.key !== "__finalize" && (isRunning || isFailed) && item.progress !== undefined && (
                    <div role="progressbar" aria-label={`${item.title}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress || 0)} className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full w-full origin-left rounded-full transition-[transform,background-color] duration-300", isFailed ? "bg-red-500" : "bg-primary")}
                        style={{ transform: `scaleX(${Math.max(0, Math.min(100, item.progress || 0)) / 100})` }}
                      />
                    </div>
                  )}
                </div>

                {isCompleted && <Check className="mt-1 h-5 w-5 shrink-0 text-green-500" />}
              </div>
            );
          })}
        </div>

        {status === "failed" && (
          <div className="mb-5 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm leading-6 text-red-700 dark:text-red-300">
            <div className="font-medium">失败组件：{failedTitle}</div>
            <div className="mt-1 break-words">{error || "下载失败，请检查网络或 GitHub 加速配置。"}</div>
            <div className="mt-1 text-muted-foreground">也可以登录后进入系统设置页面，在组件更新里手动下载。</div>
          </div>
        )}

        <div role="progressbar" aria-label="初始化总进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overall} className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-300" style={{ transform: `scaleX(${overall / 100})` }} />
        </div>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          {status === "failed" ? "处理失败后可重试，或登录后到系统设置中手动下载组件" : "初始化完成后将自动跳转到登录页面"}
        </p>

        {status === "failed" && (
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <SetupPageButton disabled={busy} onClick={onManual}>
              登录后去系统设置手动下载
            </SetupPageButton>
            <SetupPageButton variant="primary" disabled={busy} onClick={onRetry}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              重试下载
            </SetupPageButton>
          </div>
        )}
      </div>
    </div>
  );
}

export function SetupPage() {
  const navigate = useNavigate();
  const { initialized, user, loading, refresh, setupNeedsRecovery, setupDownloadComponents } = useAuth();
  const { language, setLanguage } = useLanguage();
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showSetupPasswords, setShowSetupPasswords] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [downloadIntroStage, setDownloadIntroStage] = useState<SetupDownloadIntroStage>(2);
  const [downloadSteps, setDownloadSteps] = useState<SetupDownloadStep[]>([]);
  const [downloadError, setDownloadError] = useState("");
  const [failedComponent, setFailedComponent] = useState("");
  const [mosdnsInstallMode, setMosdnsInstallMode] = useState<"upload" | "url">("upload");
  const [mosdnsBundleFile, setMosdnsBundleFile] = useState<File | null>(null);
  const [mosdnsBundleURL, setMosdnsBundleURL] = useState("");
  const [system, setSystem] = useState<SetupSystemInfo | null>(null);
  const [privilege, setPrivilege] = useState<PrivilegeInfo | null>(null);
  const [preflight, setPreflight] = useState<SetupPreflight | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [portRiskAccepted, setPortRiskAccepted] = useState(false);
  const [ifaces, setIfaces] = useState<NetworkInterface[]>([]);
  const [form, setForm] = useState<SetupForm>(defaultForm);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [manualNodes, setManualNodes] = useState<string[]>([]);
  const [nodeMode, setNodeMode] = useState<"share" | "yaml">("share");
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [themeOpen, setThemeOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const isDark = theme === "dark" || (theme === "system" && prefersDarkMode());
  const ThemeIcon = theme === "system" ? Monitor : isDark ? Moon : Sun;
  const languageOptions: Array<{ id: AppLanguage; label: string }> = [
    { id: "zh-CN", label: "简体中文" },
    { id: "en-US", label: "English" },
  ];

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [theme]);

  useEffect(() => {
    if (!themeOpen && !languageOpen) return;
    const close = () => {
      setThemeOpen(false);
      setLanguageOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [languageOpen, themeOpen]);

  useEffect(() => {
    if (!loading && initialized && !setupNeedsRecovery) {
      navigate(user ? "/" : "/login", { replace: true });
    }
  }, [loading, initialized, setupNeedsRecovery, user, navigate]);

  useEffect(() => {
    if (loading || !initialized || !setupNeedsRecovery || downloadStatus !== "idle") return;
    const components = normalizeDownloadComponents(setupDownloadComponents, form);
    setStep(steps.length - 1);
    setFurthestStep(steps.length - 1);
    setDownloadIntroStage(2);
    setDownloadSteps(createDownloadSteps(components));
    setDownloadStatus("failed");
    setDownloadError("核心组件尚未安装完成。您可以重试下载，或登录后到系统设置的组件更新页手动下载。");
    setFailedComponent(components[0] || "");
  }, [downloadStatus, form, initialized, loading, setupDownloadComponents, setupNeedsRecovery]);

  useEffect(() => {
    Promise.allSettled([
      api<any>("/api/v1/setup/privilege", { skipAuth: true }),
      api<any>("/api/v1/setup/system-info", { skipAuth: true }),
      api<any>("/api/v1/setup/network-interfaces", { skipAuth: true }),
    ]).then(([privilegeResult, systemResult, networkResult]) => {
      if (privilegeResult.status === "fulfilled") {
        setPrivilege(privilegeResult.value);
        const dockerRuntime = Boolean(privilegeResult.value?.runtime?.docker);
        const macOSRuntime = Boolean(privilegeResult.value?.runtime?.macos);
        if (dockerRuntime || macOSRuntime) {
          setForm((current) => ({
            ...current,
            linux_proxy_mode: "tun",
            enableIPv6: false,
            ...(macOSRuntime ? { auto_set_dns: true, dns_on: "127.0.0.1" } : {}),
          }));
        }
      }
      if (systemResult.status === "fulfilled") {
        setSystem(systemResult.value);
        if (systemResult.value?.system?.os === "darwin") {
          setForm((current) => ({
            ...current,
            linux_proxy_mode: "tun",
            auto_set_dns: true,
            dns_on: "127.0.0.1",
            enableIPv6: false,
          }));
        }
      }
      if (networkResult.status === "fulfilled") {
        const rows = networkRows(networkResult.value);
        setIfaces(rows);
        const first =
          rows.find((item) => item.recommended || (item.is_default && item.is_usable !== false))
          || rows.find((item) => item.is_up && !item.is_loopback && Boolean(item.primary_ip || item.ip))
          || rows.find((item) => item.is_usable)
          || rows[0];
        if (first?.name) setForm((current) => ({ ...current, selected_interface: first.name }));
      }
      const firstError = [privilegeResult, systemResult, networkResult].find((result) => result.status === "rejected");
      if (firstError?.status === "rejected") setMessage(errorMessage(firstError.reason));
    });
  }, []);

  const selectedInterface = useMemo(
    () => ifaces.find((item) => item.name === form.selected_interface),
    [ifaces, form.selected_interface]
  );

  const platform = `${system?.system?.os || "-"} / ${system?.system?.arch || "-"}`;
  const cpu = `${system?.cpu?.model || "-"} · ${system?.cpu?.cores || "-"} ${language === "en-US" ? "cores" : "核"}`;
  const ifaceLabel = selectedInterface
    ? `${selectedInterface.name} - ${selectedInterface.primary_ip || selectedInterface.ip || "-"}${selectedInterface.speed ? ` (${selectedInterface.speed})` : ""}`
    : "";
  const amd64v3Status = system?.cpu?.amd64v3_status || (system?.cpu?.supportsAMD64v3 ? "supported" : "unsupported");
  const amd64v3Supported = amd64v3Status === "supported";
  const subscriptionText = serializeSubscriptions(subscriptions);
  const manualProxyText =
    nodeMode === "yaml"
      ? form.mihomo_proxies.trim()
      : manualNodes
          .map((node) => node.trim())
          .filter(Boolean)
          .join("\n");
  const manualNodeCount = nodeMode === "yaml" ? (form.mihomo_proxies.trim() ? 1 : 0) : manualNodes.filter((node) => node.trim()).length;
  const occupiedPorts = useMemo(() => occupiedReservedPorts(preflight), [preflight]);
  const hasPortWarnings = occupiedPorts.length > 0;
  const isDockerRuntime = Boolean(privilege?.runtime?.docker);
  const isMacOSRuntime = Boolean(privilege?.runtime?.macos) || system?.system?.os === "darwin";
  const isTunOnlyRuntime = isDockerRuntime || isMacOSRuntime;

  const fetchPreflight = useCallback(async () => {
    setPreflightBusy(true);
    try {
      const params = new URLSearchParams({
        timezone: form.timezone,
        linux_proxy_mode: form.linux_proxy_mode,
      });
      const payload = await api<SetupPreflight>(`/api/v1/setup/preflight?${params.toString()}`, { skipAuth: true });
      setPreflight(payload);
      if (occupiedReservedPorts(payload).length === 0) setPortRiskAccepted(false);
      return payload;
    } finally {
      setPreflightBusy(false);
    }
  }, [form.linux_proxy_mode, form.timezone]);

  useEffect(() => {
    if (step !== steps.length - 1 || downloadStatus !== "idle") return;
    void fetchPreflight().catch((err) => setMessage(errorMessage(err)));
  }, [downloadStatus, fetchPreflight, step]);

  const update = (key: keyof SetupForm, value: string | boolean) => {
    if (key === "linux_proxy_mode" && isTunOnlyRuntime && value !== "tun") return;
    if (key === "auto_set_dns" && isMacOSRuntime && value !== true) return;
    if (key === "timezone" || key === "linux_proxy_mode") {
      setPreflight(null);
      setPortRiskAccepted(false);
    }
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setForm((current) => ({ ...current, [key]: value }));
  };

  const setSubscription = (index: number, patch: Partial<SubscriptionRow>) => {
    setSubscriptions((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const setManualNode = (index: number, value: string) => {
    setManualNodes((rows) => rows.map((row, rowIndex) => (rowIndex === index ? value : row)));
  };

  const focusIssue = useCallback((issue: SetupValidationIssue) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(`[data-setup-field="${issue.field}"]`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
    });
  }, []);

  const showIssues = useCallback((issues: SetupValidationIssue[]) => {
    if (issues.length === 0) return false;
    const issueMap = Object.fromEntries(issues.map((issue) => [issue.field, issue.message]));
    const first = issues[0];
    setFieldErrors(issueMap);
    setMessage(first.message);
    setStep(first.step);
    focusIssue(first);
    return true;
  }, [focusIssue]);

  const activateAndGoLogin = async () => {
    await api("/api/v1/setup/activate", { method: "POST", skipAuth: true });
    await refresh();
    navigate("/login", { replace: true });
  };

  const runDownloadFlow = async (componentsValue: unknown) => {
    const components = normalizeDownloadComponents(componentsValue, form);
    if (components.length === 0) {
      await activateAndGoLogin();
      return;
    }
    setDownloadIntroStage(0);
    setDownloadSteps(createDownloadSteps(components));
    setDownloadStatus("running");
    setDownloadError("");
    setFailedComponent("");
    await wait(340);
    setDownloadIntroStage(1);
    await wait(340);
    setDownloadIntroStage(2);
    await wait(120);
    for (const component of components) {
      setDownloadSteps((items) =>
        items.map((item) =>
          item.component === component
            ? { ...item, status: "running", progress: Math.max(item.progress, 1), message: "正在连接下载服务" }
            : item
        )
      );
      try {
        const onEvent = (event: SetupDownloadEvent) => {
          const eventStatus = String(event.status || "running").toLowerCase();
          const status: SetupDownloadStatus =
            eventStatus === "completed" || eventStatus === "skipped" || eventStatus === "failed"
              ? (eventStatus as SetupDownloadStatus)
              : "running";
          setDownloadSteps((items) =>
            items.map((item) =>
              item.component === component
                ? {
                    ...item,
                    status,
                    progress: Math.max(0, Math.min(100, Number(event.progress ?? item.progress ?? 0))),
                    message: event.message || item.message,
                  }
                : item
            )
          );
        };
        if (component === "mosdns") {
          if (mosdnsInstallMode === "upload") {
            if (!mosdnsBundleFile) {
              throw new Error("请先选择 MosDNS 本地 ZIP 文件");
            }
            await uploadMosDNSBundle(mosdnsBundleFile, onEvent);
          } else {
            const url = mosdnsBundleURL.trim();
            if (!url) {
              throw new Error("请输入 MosDNS ZIP 链接");
            }
            await installMosDNSBundleFromURL(url, onEvent);
          }
        } else {
          await streamSetupDownload(component, onEvent);
        }
        setDownloadSteps((items) =>
          items.map((item) =>
            item.component === component ? { ...item, status: item.status === "skipped" ? "skipped" : "completed", progress: 100 } : item
          )
        );
      } catch (err) {
        const msg = errorMessage(err);
        setFailedComponent(component);
        setDownloadError(msg);
        setDownloadStatus("failed");
        setDownloadSteps((items) =>
          items.map((item) =>
            item.component === component ? { ...item, status: "failed", message: msg, progress: Math.max(item.progress, 1) } : item
          )
        );
        return;
      }
    }
    setDownloadStatus("completed");
    try {
      await activateAndGoLogin();
    } catch (err) {
      setFailedComponent("__activate");
      setDownloadError(`核心组件已下载，但服务启动失败：${errorMessage(err)}`);
      setDownloadStatus("failed");
    }
  };

  const completeInitialize = async () => {
    const errors = validateAllSetupSteps({ ...form, mosdnsInstallMode, mosdnsBundleFile, mosdnsBundleURL });
    if (showIssues(errors)) return;
    setBusy(true);
    setMessage("");
    try {
      const latestPreflight = await fetchPreflight();
      const latestOccupiedPorts = occupiedReservedPorts(latestPreflight);
      if (latestPreflight.blocking) {
        setMessage((latestPreflight.errors || []).join("；") || latestPreflight.dns53?.message || "初始化前检查未通过");
        return;
      }
      if (latestOccupiedPorts.length > 0 && !portRiskAccepted) {
        setMessage("检测到非常用端口占用，请确认风险后再继续初始化");
        return;
      }
      const payload = await api<any>("/api/v1/setup/initialize", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          subscription_urls: subscriptionText,
          mihomo_proxies: manualProxyText,
        }),
        skipAuth: true,
      });
      setBusy(false);
      await runDownloadFlow(payload?.download_component);
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const retryDownloads = async () => {
    setBusy(true);
    try {
      const components = downloadSteps.length > 0 ? downloadSteps.map((item) => item.component) : setupDownloadComponents;
      await runDownloadFlow(components);
    } finally {
      setBusy(false);
    }
  };

  const goManualDownload = async () => {
    setBusy(true);
    try {
      await api("/api/v1/setup/activate", { method: "POST", skipAuth: true }).catch(() => null);
      await refresh().catch(() => undefined);
      navigate(`/login?redirect=${encodeURIComponent("/settings?tab=update")}`, { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const go = (nextStep: number) => {
    setMessage("");
    const target = Math.max(0, Math.min(steps.length - 1, nextStep));
    if (target <= step) {
      setFieldErrors({});
      setStep(target);
      return;
    }
    const issues = validateSetupStep(step, { ...form, mosdnsInstallMode, mosdnsBundleFile, mosdnsBundleURL });
    if (showIssues(issues)) return;
    setFieldErrors({});
    setFurthestStep((current) => Math.max(current, target));
    setStep(target);
  };

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    const target = event.target as HTMLElement;
    if (!touch || touch.clientX < 24 || touch.clientX > window.innerWidth - 24 || target.closest("input, textarea, select, button, label, a")) {
      touchStart.current = null;
      return;
    }
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    if (deltaX < 0 && step < steps.length - 1) go(step + 1);
    if (deltaX > 0 && step > 0) go(step - 1);
  };

  const footer = (
    <>
      <SetupPageButton disabled={step === 0 || busy} onClick={() => go(step - 1)}>
        <ArrowLeft className="h-4 w-4" />
        上一步
      </SetupPageButton>
      {step < steps.length - 1 ? (
        <SetupPageButton variant="primary" disabled={busy} onClick={() => go(step + 1)}>
          下一步
          <ArrowRight className="h-4 w-4" />
        </SetupPageButton>
      ) : (
        <SetupPageButton
          variant="primary"
          disabled={busy || preflightBusy || Boolean(preflight?.blocking) || (hasPortWarnings && !portRiskAccepted)}
          onClick={() => void completeInitialize()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          完成初始化
        </SetupPageButton>
      )}
    </>
  );

  if (downloadStatus !== "idle") {
    return (
      <SetupDownloadView
        steps={downloadSteps}
        introStage={downloadIntroStage}
        status={downloadStatus}
        error={downloadError}
        failedComponent={failedComponent}
        busy={busy}
        onRetry={() => void retryDownloads()}
        onManual={() => void goManualDownload()}
      />
    );
  }

  return (
    <div className="gary-public-page msf-setup-page text-foreground">
      <SceneBackdrop scene="neutral" />
      <div className="fixed right-[max(1rem,env(safe-area-inset-right))] top-[max(1rem,env(safe-area-inset-top))] z-40 flex items-center gap-1 rounded-[16px] border border-border/60 bg-background/55 p-1 text-muted-foreground shadow-sm backdrop-blur-xl sm:right-8 sm:top-6">
        <div className="relative">
          <button
            className="gary-icon-button flex h-9 w-9 items-center justify-center rounded-[12px] border-0 bg-transparent p-0 shadow-none hover:text-foreground"
            type="button"
            title="切换主题"
            aria-label="切换主题"
            aria-haspopup="menu"
            aria-expanded={themeOpen}
            onClick={(event) => {
              event.stopPropagation();
              setThemeOpen((current) => !current);
              setLanguageOpen(false);
            }}
          >
            <ThemeIcon className="h-5 w-5" />
          </button>
          {themeOpen && (
            <div role="menu" onClick={(event) => event.stopPropagation()} className="gary-popover absolute right-0 mt-2 w-44 p-1.5">
              {themeOptions.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === id}
                  onClick={() => {
                    setTheme(id);
                    applyTheme(id);
                    setThemeOpen(false);
                  }}
                  className="gary-popover__item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-foreground"
                >
                  <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" />{label}</span>
                  {theme === id && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button
            className="gary-icon-button flex h-9 w-9 items-center justify-center rounded-[12px] border-0 bg-transparent p-0 shadow-none hover:text-foreground"
            type="button"
            title="语言"
            aria-label="语言"
            aria-haspopup="menu"
            aria-expanded={languageOpen}
            onClick={(event) => {
              event.stopPropagation();
              setLanguageOpen((current) => !current);
              setThemeOpen(false);
            }}
          >
            <Languages className="h-5 w-5" />
          </button>
          {languageOpen && (
            <div role="menu" onClick={(event) => event.stopPropagation()} className="gary-popover absolute right-0 mt-2 w-40 p-1.5">
              {languageOptions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={language === item.id}
                  onClick={() => {
                    setLanguage(item.id);
                    setLanguageOpen(false);
                  }}
                  className="gary-popover__item flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-foreground"
                >
                  {item.label}
                  {language === item.id && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <main className="msf-setup-main mx-auto w-full max-w-[1180px] px-3 pb-10 pt-[max(5rem,calc(env(safe-area-inset-top)+4rem))] sm:px-6 sm:pt-10">
        <header className="flex items-center gap-3 px-7">
          <img src="/logo/logo-square.png" alt="MSF" className="h-9 w-9" />
          <h1 className="text-xl font-bold tracking-normal text-foreground">MSF 初始化向导</h1>
        </header>

        <GlassSurface
          width="100%"
          height="auto"
          borderRadius={28}
          disableDisplacement
          className="msf-setup-shell mt-6"
        >
          <SetupStepper current={step} furthest={furthestStep} onStepClick={go} />
          <SetupCard footer={footer}>
            <div key={step} className="msf-setup-step-enter" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            {step === 0 && (
              <div className="mx-auto max-w-[960px] space-y-5">
                <div className="flex flex-col gap-4 border-b border-border/60 pb-5 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">设置管理入口</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">创建管理员账户，并确认管理页面的基础系统参数。</p>
                  </div>
                  <div className="text-left text-xs text-muted-foreground sm:text-right">
                    <div>{platform}</div>
                    <div className="mt-1">{cpu}</div>
                  </div>
                </div>

                {privilege && (
                  <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", privilege.is_root ? "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-300" : "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300")}>
                    {privilege.is_root ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div>
                      <div className="font-medium">{privilege.is_root ? "运行权限检查通过" : "运行权限检查未通过"}</div>
                      <div className="mt-0.5 text-xs leading-5">{privilege.is_root ? "当前服务具备生成配置和管理网络服务所需的权限。" : privilege.message || "MosDNS 53 端口和 TUN/nftables 需要管理员权限。"}</div>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                  <SetupSection title="管理员账户" description="用户名和密码是必填项；邮箱可以留空。">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="用户名" error={fieldErrors.username}>
                        <div className="relative">
                          <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <input className={cn(inputClass, "pl-9", fieldErrors.username && "msf-setup-field-error")} name="username" data-setup-field="username" autoComplete="username" spellCheck={false} aria-invalid={Boolean(fieldErrors.username) || undefined} placeholder="请输入管理员用户名" value={form.username} onChange={(event) => update("username", event.target.value)} />
                        </div>
                      </Field>
                      <Field label="邮箱（可选）" error={fieldErrors.email}>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <input className={cn(inputClass, "pl-9", fieldErrors.email && "msf-setup-field-error")} name="email" data-setup-field="email" type="email" autoComplete="email" spellCheck={false} aria-invalid={Boolean(fieldErrors.email) || undefined} placeholder="例如 admin@example.com" value={form.email} onChange={(event) => update("email", event.target.value)} />
                        </div>
                      </Field>
                      <Field label="密码" error={fieldErrors.password}>
                        <SetupPasswordInput name="password" value={form.password} placeholder="请输入密码" show={showSetupPasswords} invalid={Boolean(fieldErrors.password)} onChange={(value) => update("password", value)} onToggle={() => setShowSetupPasswords((current) => !current)} />
                      </Field>
                      <Field label="确认密码" error={fieldErrors.confirmPassword}>
                        <SetupPasswordInput name="confirmPassword" value={form.confirmPassword} placeholder="请再次输入密码" show={showSetupPasswords} invalid={Boolean(fieldErrors.confirmPassword)} onChange={(value) => update("confirmPassword", value)} onToggle={() => setShowSetupPasswords((current) => !current)} />
                      </Field>
                    </div>
                    <p className="mt-4 text-xs leading-5 text-muted-foreground">不会强制密码组成规则。建议使用密码管理器生成并保存独立密码。</p>
                  </SetupSection>

                  <SetupSection title="管理页面" description="确认时区与 Web 管理端口；HTTPS 功能预留在当前布局中。">
                    <div className="space-y-4">
                      <Field label="时区">
                        <select className={inputClass} name="timezone" autoComplete="off" value={form.timezone} onChange={(event) => update("timezone", event.target.value)}>
                          <option value="Asia/Shanghai">Asia/Shanghai (中国)</option>
                          <option value="UTC">UTC (协调世界时)</option>
                        </select>
                      </Field>
                      <Field label="Web 管理端口" hint="范围 1-65535；1-1023 是特权端口。" error={fieldErrors.webPort}>
                        <input className={cn(inputClass, fieldErrors.webPort && "msf-setup-field-error")} name="webPort" data-setup-field="webPort" type="number" inputMode="numeric" min={1} max={65535} autoComplete="off" aria-invalid={Boolean(fieldErrors.webPort) || undefined} value={form.webPort} onChange={(event) => update("webPort", event.target.value)} />
                      </Field>
                      <ToggleRow title="启用 HTTPS" description="需要配置 SSL 证书" checked={form.enableHttps} disabled onChange={(checked) => update("enableHttps", checked)} badge={<Badge>开发中</Badge>} />
                    </div>
                  </SetupSection>
                </div>
              </div>
            )}

            {step === 1 && (
                <div className="mx-auto max-w-[960px] space-y-4">
                  <div className="border-b border-border/60 pb-5">
                    <h2 className="text-2xl font-semibold tracking-[-0.025em]">网络与 DNS</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">确认运行网卡、DNS 接管方式、IPv6 数据面和 Fake-IP 网段。</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Cpu className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                            AMD64 v3 优化
                            <Badge tone={amd64v3Supported ? "success" : "warning"}>
                              {amd64v3Supported ? "支持 AMD64 v3" : "您的 CPU 不支持 AMD64 v3 指令集"}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">启用 CPU 指令集优化以提升性能</p>
                          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                              name="amd64v3_enabled"
                              type="checkbox"
                              disabled={!amd64v3Supported}
                              checked={form.amd64v3_enabled}
                              onChange={(event) => update("amd64v3_enabled", event.target.checked)}
                              className="h-3.5 w-3.5 accent-primary"
                            />
                            启用优化
                          </label>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Network className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">物理网卡</div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">选择用于服务的网络接口</p>
                          <select
                            className={cn(inputClass, "mt-3 h-8 text-xs", fieldErrors.selected_interface && "msf-setup-field-error")}
                            name="selected_interface"
                            data-setup-field="selected_interface"
                            autoComplete="off"
                            aria-invalid={Boolean(fieldErrors.selected_interface) || undefined}
                            value={form.selected_interface}
                            onChange={(event) => update("selected_interface", event.target.value)}
                          >
                            {ifaces.length === 0 && <option value="">请选择网络接口</option>}
                            {ifaces.map((iface) => (
                              <option key={iface.name} value={iface.name} disabled={isMacOSRuntime && iface.is_usable === false}>
                                {iface.name} - {iface.primary_ip || iface.ip || "无可用 IP"} {iface.recommended ? "（默认出口）" : iface.speed ? `(${iface.speed})` : ""}
                              </option>
                            ))}
                          </select>
                          {fieldErrors.selected_interface && <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-300">{fieldErrors.selected_interface}</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Server className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="text-sm font-semibold">DNS 设置</div>
                        <div className="text-xs text-muted-foreground">本机DNS设置</div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-background p-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-xs font-semibold">{isMacOSRuntime ? "macOS DNS 自动接管" : "自动修改本机 DNS"}</div>
                          <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                            {isMacOSRuntime
                              ? "TUN 启动时固定切换到本机 MosDNS（127.0.0.1）；完全停止时按启动前快照恢复各网络服务的原始 DNS。"
                              : "开启后自动将系统 DNS 切换为 mosdns（127.0.0.1），关闭则仅生成配置不改动系统 DNS"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => update("auto_set_dns", !form.auto_set_dns)}
                          disabled={isMacOSRuntime}
                          className={cn(
                            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0",
                            form.auto_set_dns ? "bg-primary" : "bg-muted",
                            isMacOSRuntime && "cursor-not-allowed opacity-80"
                          )}
                          aria-label="自动修改本机 DNS"
                          aria-pressed={form.auto_set_dns}
                        >
                          <span className={cn("pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", form.auto_set_dns ? "translate-x-5" : "translate-x-0")} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="服务启动后本机 DNS" hint={isMacOSRuntime ? "macOS TUN 固定使用本机 MosDNS" : "服务启动后系统将使用的 DNS 地址，默认 127.0.0.1"}>
                        <input
                          className={cn(inputClass, "h-8 text-xs")}
                          name="dns_on"
                          autoComplete="off"
                          value={isMacOSRuntime ? "127.0.0.1" : form.dns_on}
                          disabled={isMacOSRuntime}
                          onChange={(event) => update("dns_on", event.target.value)}
                        />
                      </Field>
                      <Field label="服务停止后本机 DNS" hint={isMacOSRuntime ? "完整停止时恢复启动前捕获的系统 DNS 快照" : "服务停止后恢复的 DNS 地址，默认 223.5.5.5"}>
                        <input
                          className={cn(inputClass, "h-8 text-xs")}
                          name="dns_off"
                          autoComplete="off"
                          value={isMacOSRuntime ? "按启动前系统快照恢复" : form.dns_off}
                          disabled={isMacOSRuntime}
                          onChange={(event) => update("dns_off", event.target.value)}
                        />
                      </Field>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Globe2 className="h-4 w-4" />
                      </span>
                      <div className="text-sm font-semibold">IPv6 设置</div>
                    </div>
                    <ToggleRow
                      title="启用 IPv6 数据面"
                      description="控制 MSF/Mihomo IPv6 代理数据面；不会关闭主机或路由器的原生 IPv6，也不等同于 MosDNS 屏蔽 AAAA。"
                      checked={form.enableIPv6}
                      onChange={(checked) => update("enableIPv6", checked)}
                    />
                    <div className="mt-2 flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>请确认当前网络支持 IPv6。可以前往 <a className="underline underline-offset-2" href="https://test-ipv6.com" target="_blank" rel="noreferrer">IPv6 测试页面</a>检查。</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Wifi className="h-4 w-4" />
                      </span>
                      <div className="text-sm font-semibold">Fake-IP 网段配置</div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="IPv4 Fake-IP 网段" hint="默认使用 28.0.0.0/8 网段，请确保与其他代理工具不冲突">
                        <input className={cn(inputClass, "h-8 text-xs")} name="fakeIPRangeV4" autoComplete="off" spellCheck={false} value={form.fakeIPRangeV4} onChange={(event) => update("fakeIPRangeV4", event.target.value)} />
                      </Field>
                      <Field label="IPv6 Fake-IP 网段" hint="默认使用 f2b0::/18 网段，仅在启用 IPv6 时生效">
                        <input className={cn(inputClass, "h-8 text-xs")} name="fakeIPRangeV6" autoComplete="off" spellCheck={false} value={form.fakeIPRangeV6} onChange={(event) => update("fakeIPRangeV6", event.target.value)} />
                      </Field>
                    </div>
                    <div className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
                      <p>此开关控制 MSF/Mihomo 的 IPv6 代理数据面，不会关闭操作系统、路由器或运营商提供的原生 IPv6。</p>
                      <p>开启后会联动 Mihomo 顶层 ipv6、dns.ipv6、FakeIPv6 捕获、NFT IPv6 规则、IPv6 policy route，以及 TUN/Docker IPv6 路由；关闭后保留 FakeIPv6 前缀配置，但卸载这些 IPv6 代理链路。</p>
                      <p>此开关不等同于 MosDNS 的“屏蔽 AAAA”。若关闭 IPv6 数据面但 MosDNS 仍允许 AAAA，客户端可能获得真实 IPv6 地址并通过原生 IPv6 绕过 Mihomo。请同时在 MosDNS 系统设置中确认 AAAA 屏蔽与 IPv4/IPv6 优先级。</p>
                      <p>修改 FakeIPv6 网段会清理相关缓存；若当前 Mihomo 不支持在线清理，系统会短暂重启服务并重建缓存。自定义配置模式下需先手工对齐 active config，否则保存会被拒绝。</p>
                      <p>若修改后个别网页仍无法访问，请停止 Mihomo，仅清除用户数据目录下的 Mihomo FakeIP 缓存后再启动；不要删除配置或订阅。详细路径见常见问题 FAQ。</p>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
              <div className="mx-auto max-w-[960px] space-y-4">
                <div className="border-b border-border/60 pb-5">
                  <h2 className="text-2xl font-semibold tracking-[-0.025em]">组件与代理</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">MosDNS 可通过本地 ZIP 或 ZIP 链接安装，代理核心使用 Mihomo。</p>
                </div>
                <div data-setup-field="mosdnsEnabled" className="flex min-h-[58px] w-full items-center gap-3 rounded-[16px] border border-primary/35 bg-primary/10 px-4 text-left shadow-[inset_0_1px_0_var(--gary-edge-soft)]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Server className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">MosDNS</span>
                    <span className="block text-xs text-muted-foreground">DNS 服务器，提供 DNS 分流和广告过滤功能</span>
                  </span>
                  <Badge tone="success">必选</Badge>
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                </div>
                <div className="rounded-[16px] border border-border/65 bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">MosDNS 安装方式</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">使用包含 MosDNS 与 mosdns-traffic-agent 的 ZIP 包。</p>
                    </div>
                    <div className="inline-flex rounded-[10px] border border-border p-1" role="group" aria-label="MosDNS 安装方式">
                      <button
                        type="button"
                        onClick={() => setMosdnsInstallMode("upload")}
                        className={cn("rounded-[8px] px-3 py-1.5 text-xs font-medium", mosdnsInstallMode === "upload" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
                      >
                        本地上传
                      </button>
                      <button
                        type="button"
                        onClick={() => setMosdnsInstallMode("url")}
                        className={cn("rounded-[8px] px-3 py-1.5 text-xs font-medium", mosdnsInstallMode === "url" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
                      >
                        ZIP 链接
                      </button>
                    </div>
                  </div>
                  {mosdnsInstallMode === "upload" ? (
                    <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border/80 bg-background px-3 py-2 text-xs text-muted-foreground hover:bg-accent/40">
                      <Upload className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{mosdnsBundleFile ? mosdnsBundleFile.name : "选择 MosDNS ZIP 文件"}</span>
                      <input
                        type="file"
                        accept=".zip,application/zip"
                        className="sr-only"
                        onChange={(event) => setMosdnsBundleFile(event.target.files?.[0] || null)}
                      />
                    </label>
                  ) : (
                    <input
                      className={cn(inputClass, "mt-3")}
                      type="url"
                      inputMode="url"
                      placeholder="https://example.com/mosdns-bundle.zip"
                      value={mosdnsBundleURL}
                      onChange={(event) => setMosdnsBundleURL(event.target.value)}
                    />
                  )}
                </div>
                <div>
                  <div className="text-sm font-semibold">代理核心</div>
                  <div className="mt-3 space-y-3">
                    <button
                      type="button"
                      onClick={() => update("proxyCore", "mihomo")}
                      data-setup-field="proxyCore"
                      aria-pressed={form.proxyCore === "mihomo"}
                      className="flex min-h-[58px] w-full items-center gap-3 rounded-[16px] border border-primary/40 bg-primary/10 px-4 py-3 text-left shadow-[inset_0_1px_0_var(--gary-edge-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <ShieldCheck className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">Mihomo</span>
                        <span className="block text-xs text-muted-foreground">通用代理平台，支持多种协议</span>
                      </span>
                      <Circle className="h-4 w-4 fill-primary text-primary" />
                    </button>
                    <div className="rounded-[16px] border border-border/65 bg-card px-4 py-3">
                      <div className="text-xs text-muted-foreground">Mihomo Core</div>
                      <div className="mt-2 inline-flex rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                        Meta（官方稳定版）
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <SlidersHorizontal className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold">{isMacOSRuntime ? "macOS TUN 网络" : "Linux 透明代理"}</div>
                      <div className="text-xs text-muted-foreground">
                        {isMacOSRuntime ? "由系统 LaunchDaemon 管理 DNS、utun 与 LAN 转发" : "Linux 透明代理配置"}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-2 text-sm font-medium">{isMacOSRuntime ? "macOS 接管模式" : "Linux 透明代理模式"}</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {!isTunOnlyRuntime && (
                          <ChoiceCard
                            title="nftables 转发（TProxy + Redirect）"
                            description="Linux 下 Mihomo 支持 nftables 转发，默认使用 nftables 转发。"
                            selected={form.linux_proxy_mode === "nft"}
                            onClick={() => update("linux_proxy_mode", "nft")}
                          />
                        )}
                        <ChoiceCard
                          title={
                            isMacOSRuntime
                              ? "TUN 模式（macOS 唯一支持模式）"
                              : isDockerRuntime
                                ? "TUN 模式（Docker 唯一支持模式）"
                                : "TUN 模式"
                          }
                          description={
                            isMacOSRuntime
                              ? "MosDNS 接管本机与局域网 DNS，Mihomo utun 接管 Fake-IP 路由；停止时保留 TUN 并切换为直连。"
                              : isDockerRuntime
                              ? "需要 /dev/net/tun 与 NET_ADMIN；由 MosDNS 负责 DNS 分流，Mihomo TUN 接管 Fake-IP 路由。"
                              : "需要 /dev/net/tun、NET_ADMIN 和正确 DNS 链路；Mihomo TUN 接管 Fake-IP 路由，不写 nftables 策略。"
                          }
                          selected={form.linux_proxy_mode === "tun"}
                          onClick={() => update("linux_proxy_mode", "tun")}
                        />
                      </div>
                    </div>
                    {form.linux_proxy_mode !== "tun" && (
                      <div>
                        <div className="mb-2 text-sm font-medium">nftables 代理策略</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <ChoiceCard
                            title="默认直连（推荐）"
                            description="只有规则内的流量走代理服务，其他流量走 MosDNS 国内 DNS。适合大多数场景。"
                            selected={form.nft_proxy_policy === "direct_default"}
                            onClick={() => update("nft_proxy_policy", "direct_default")}
                          />
                          <ChoiceCard
                            title="默认代理"
                            description="只有规则内的流量走 MosDNS，其他不在规则内的都进代理服务。"
                            selected={form.nft_proxy_policy === "proxy_default"}
                            onClick={() => update("nft_proxy_policy", "proxy_default")}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <SetupSection title="订阅链接" description="机场订阅链接">
                  <div className="space-y-3">
                    {subscriptions.map((row, index) => (
                      <div key={index} className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)_auto]">
                        <input
                          className={inputClass}
                          name={`subscription_name_${index}`}
                          aria-label={`订阅 ${index + 1} 名称`}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="例如 主用订阅"
                          value={row.tag}
                          onChange={(event) => setSubscription(index, { tag: event.target.value })}
                        />
                        <input
                          className={inputClass}
                          name={`subscription_url_${index}`}
                          aria-label={`订阅 ${index + 1} URL`}
                          type="url"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="例如 https://example.com/subscription"
                          value={row.url}
                          onChange={(event) => setSubscription(index, { url: event.target.value })}
                        />
                        <SetupPageButton onClick={() => setSubscriptions((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>
                          删除
                        </SetupPageButton>
                      </div>
                    ))}
                    <SetupPageButton onClick={() => setSubscriptions((rows) => [...rows, { tag: "", url: "" }])}>
                      添加订阅
                    </SetupPageButton>
                  </div>
                </SetupSection>
                <SetupSection title="自定义节点（可选）">
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setNodeMode("share")}
                        aria-pressed={nodeMode === "share"}
                        className={cn("rounded-lg border px-3 py-2 text-xs font-medium", nodeMode === "share" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
                      >
                        分享链接模式
                      </button>
                      <button
                        type="button"
                        onClick={() => setNodeMode("yaml")}
                        aria-pressed={nodeMode === "yaml"}
                        className={cn("rounded-lg border px-3 py-2 text-xs font-medium", nodeMode === "yaml" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
                      >
                        YAML 文本模式
                      </button>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {nodeMode === "share"
                        ? "分享链接模式：支持协议：ss、ssr、trojan、vmess、vless、hysteria、hysteria2、tuic"
                        : "YAML 文本模式：可粘贴 Mihomo 的 proxies: 段落，或直接粘贴 - name 开头的节点列表"}
                    </p>
                    {nodeMode === "share" ? (
                      <div className="space-y-2">
                        {manualNodes.map((node, index) => (
                          <div key={index} className="grid gap-2 sm:grid-cols-[32px_minmax(0,1fr)_auto] sm:items-center">
                            <span className="hidden h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary sm:flex">
                              {index + 1}
                            </span>
                            <input
                              className={inputClass}
                              name={`manual_node_${index}`}
                              aria-label={`自定义节点 ${index + 1}`}
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="例如 ss://、trojan:// 或 vmess://…"
                              value={node}
                              onChange={(event) => setManualNode(index, event.target.value)}
                            />
                            <SetupPageButton onClick={() => setManualNodes((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>
                              <Trash2 className="h-4 w-4" />
                              删除
                            </SetupPageButton>
                          </div>
                        ))}
                        <div className="flex flex-wrap items-center gap-3">
                          <SetupPageButton onClick={() => setManualNodes((rows) => [...rows, ""])}>
                            <Plus className="h-4 w-4" />
                            添加节点
                          </SetupPageButton>
                          <span className="text-xs text-muted-foreground">已添加 {manualNodes.length} 条</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <textarea
                          className={cn(inputClass, "min-h-36 resize-y py-3 font-mono leading-6")}
                          name="mihomo_proxies"
                          aria-label="Mihomo 自定义节点 YAML"
                          autoComplete="off"
                          spellCheck={false}
                          value={form.mihomo_proxies}
                          onChange={(event) => update("mihomo_proxies", event.target.value)}
                          placeholder={'proxies:\n  - name: "my-node"\n    type: trojan\n    server: example.com\n    port: 443\n    password: "xxx"\n    sni: example.com'}
                        />
                        <span className="text-xs text-muted-foreground">已添加 {manualNodeCount} 组 YAML 配置</span>
                      </div>
                    )}
                  </div>
                </SetupSection>
                <SetupSection title="GitHub 下载加速（可选）" description="可同时配置多种加速方式，留空则直连下载。">
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <CheckOption
                      name="github_proxy_enabled"
                      title="代理服务器"
                      description="使用 HTTP/HTTPS/SOCKS5 代理下载组件"
                      checked={form.github_proxy_enabled}
                      onChange={(checked) => update("github_proxy_enabled", checked)}
                      >
                        <div className="space-y-1 pl-0.5">
                        <input
                            className={cn(inputClass, "h-8 text-xs")}
                            name="github_https_proxy"
                            aria-label="GitHub 下载 HTTPS 代理"
                            type="url"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="HTTPS 代理，例如 http://127.0.0.1:7890"
                            value={form.github_https_proxy}
                            onChange={(event) => update("github_https_proxy", event.target.value)}
                        />
                        <input
                            className={cn(inputClass, "h-8 text-xs")}
                            name="github_http_proxy"
                            aria-label="GitHub 下载 HTTP 代理"
                            type="url"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="HTTP 代理，例如 http://127.0.0.1:7890"
                            value={form.github_http_proxy}
                            onChange={(event) => update("github_http_proxy", event.target.value)}
                        />
                        <input
                            className={cn(inputClass, "h-8 text-xs")}
                            name="github_socks5_proxy"
                            aria-label="GitHub 下载 SOCKS5 代理"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="SOCKS5 代理，例如 socks5://127.0.0.1:7891"
                            value={form.github_socks5_proxy}
                            onChange={(event) => update("github_socks5_proxy", event.target.value)}
                        />
                      </div>
                      </CheckOption>
                      <CheckOption
                      name="github_accelerator_enabled"
                      title="加速代理"
                      description="使用 GitHub 加速镜像下载组件"
                      checked={form.github_accelerator_enabled}
                      onChange={(checked) => update("github_accelerator_enabled", checked)}
                      >
                        <div className="space-y-2 pl-0.5">
                        <input
                            className={cn(inputClass, "h-8 text-xs")}
                            name="github_accelerator_url"
                            aria-label="GitHub 加速前缀"
                            type="url"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="GitHub 加速前缀，例如 https://gh-proxy.com"
                            value={form.github_accelerator_url}
                            onChange={(event) => update("github_accelerator_url", event.target.value)}
                        />
                        <div className="flex flex-wrap gap-2 text-xs">
                          {[
                            ["Cloudflare", "https://gh-proxy.com"],
                            ["Fastly CDN", "https://cdn.gh-proxy.com"],
                            ["EdgeOne", "https://edgeone.gh-proxy.com"],
                          ].map(([label, value]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => update("github_accelerator_url", value)}
                              className={cn(
                                "rounded-md border px-2.5 py-1.5 transition",
                                form.github_accelerator_url === value
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:text-foreground"
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      </CheckOption>
                    </div>
                    <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><DownloadCloud className="mt-0.5 h-3.5 w-3.5 shrink-0" />这些代理设置仅用于组件下载，安装完成后会自动清除，不影响代理服务运行。</p>
                  </div>
                </SetupSection>
              </div>
            )}

            {step === 3 && (
              <div className="mx-auto max-w-[960px] space-y-5">
                <div className="flex items-center gap-4 border-b border-border/60 pb-5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-primary/12 text-primary"><CheckCircle2 className="h-5 w-5" /></span>
                  <div>
                    <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground">检查并安装</h2>
                    <p className="mt-1 text-sm text-muted-foreground">确认配置和运行环境，然后安装并启动 MSF。</p>
                  </div>
                </div>
                <div className="grid items-start gap-4 lg:grid-cols-[0.8fr_1.2fr]">
                <div className="msf-setup-panel rounded-[16px] border border-border/70 p-4 text-left">
                  <h3 className="mb-4 text-sm font-semibold">配置摘要</h3>
                  <SummaryRow label="管理员用户名" value={form.username || "root"} />
                  <SummaryRow label="时区" value={form.timezone} />
                  <SummaryRow label="Web 端口" value={form.webPort} />
                  <SummaryRow label="HTTPS" value={form.enableHttps ? "启用" : "禁用"} />
                  <SummaryRow label="MosDNS" value={form.mosdnsEnabled ? "启用" : "禁用"} />
                  <SummaryRow label="代理核心" value={form.proxyCore === "mihomo" ? "Mihomo" : form.proxyCore} />
                  <SummaryRow
                    label="透明代理模式"
                    value={(preflight?.effective_proxy_mode || form.linux_proxy_mode) === "tun" ? "TUN" : "nftables"}
                  />
                  <SummaryRow label="自定义节点" value={manualNodeCount > 0 ? `${manualNodeCount} 条/组` : "未配置"} />
                  <SummaryRow label="GitHub 加速" value={form.github_proxy_enabled || form.github_accelerator_enabled ? "已配置" : "未配置"} />
                </div>
                <div className="msf-setup-panel rounded-[16px] border border-border/70 p-4 text-left">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">初始化前检查</h3>
                    <SetupPageButton disabled={preflightBusy} onClick={() => void fetchPreflight().catch((err) => setMessage(errorMessage(err)))}>
                      {preflightBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      重新检查
                    </SetupPageButton>
                  </div>
                  {preflightBusy && !preflight ? (
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在检查 53 端口、TUN 能力、宿主机时区和业务端口占用
                    </div>
                  ) : preflight ? (
                    <div className="space-y-3">
                      <div
                        className={cn(
                          "rounded-lg border p-3 text-xs leading-5",
                          preflightDNSClass(preflight.dns53?.status)
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {preflight.dns53?.status === "blocked" || preflight.dns53?.status === "warning" ? (
                            <AlertCircle className="mt-0.5 h-4 w-4" />
                          ) : (
                            <CheckCircle2 className="mt-0.5 h-4 w-4" />
                          )}
                          <div className="min-w-0">
                            <div className="font-medium">53 端口：{preflightDNSLabel(preflight.dns53?.status)}</div>
                            <div className="mt-0.5 break-words">{preflight.dns53?.message || "未返回检查结果"}</div>
                            {preflightDNSDiagnostics(preflight.dns53).length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {preflightDNSDiagnostics(preflight.dns53).map((item) => (
                                  <div key={item} className="break-words text-[11px]">
                                    {item}
                                  </div>
                                ))}
                              </div>
                            )}
                            {(preflight.dns53?.blockers || []).length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {(preflight.dns53?.blockers || []).map((item, index) => (
                                  <div key={`${item.protocol}-${item.address}-${index}`} className="break-words text-[11px]">
                                    {item.protocol || "端口"} {listenerText(item)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
                        <div className="font-medium text-foreground">宿主机时区</div>
                        <div className="mt-1">
                          {language === "en-US" ? "Current: " : "当前："}{preflight.timezone?.current || (language === "en-US" ? "Unknown" : "未知")}{language === "en-US" ? ", target: " : "，目标："}{preflight.timezone?.target || form.timezone}
                        </div>
                        <div>{preflight.timezone?.message || "初始化时会同步宿主机时区"}</div>
                      </div>
                      {preflight.tun?.required && (
                        <div
                          className={cn(
                            "rounded-lg border p-3 text-xs leading-5",
                            preflight.tun.available
                              ? "border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-300"
                              : "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
                          )}
                        >
                          <div className="flex items-start gap-2">
                            {preflight.tun.available ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4" />
                            ) : (
                              <AlertCircle className="mt-0.5 h-4 w-4" />
                            )}
                            <div>
                              <div className="font-medium">TUN 能力：{preflight.tun.available ? "可用" : "阻断"}</div>
                              <div className="mt-0.5 break-words">{preflight.tun.message || "未返回 TUN 检查结果"}</div>
                              {preflight.tun.network_mode && (
                                <div className="text-[11px]">Docker 网络模式：{preflight.tun.network_mode}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {occupiedPorts.length > 0 ? (
                        <div className="rounded-lg border border-yellow-500/25 bg-yellow-500/10 p-3 text-xs leading-5 text-yellow-800 dark:text-yellow-300">
                          <div className="mb-2 flex items-center gap-2 font-medium">
                            <AlertCircle className="h-4 w-4" />
                            检测到非常用端口占用
                          </div>
                          <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                            {occupiedPorts.map((item, index) => (
                              <div key={`${item.protocol}-${item.port}-${index}`} className="break-words rounded-md bg-background/70 px-2 py-1">
                                <span className="font-medium">
                                  {item.protocol.toUpperCase()} {item.port}
                                </span>
                                <span> · {item.service}</span>
                                {(item.listeners || []).length > 0 ? (
                                  <span> · {(item.listeners || []).map(listenerText).join("；")}</span>
                                ) : item.message ? (
                                  <span> · {item.message}</span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                          <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
                            <input
                              name="port_risk_accepted"
                              type="checkbox"
                              checked={portRiskAccepted}
                              onChange={(event) => setPortRiskAccepted(event.target.checked)}
                              className="mt-0.5 h-3.5 w-3.5 accent-primary"
                            />
                            <span>我已确认这些端口占用风险，继续初始化。MSF 不会自动释放或杀死这些端口的进程。</span>
                          </label>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-green-500/25 bg-green-500/10 p-3 text-xs text-green-700 dark:text-green-300">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4" />
                            非 53 业务端口未发现占用
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">进入最后一步后将自动检查端口和时区。</div>
                  )}
                </div>
                </div>
              </div>
            )}
            </div>
          </SetupCard>
          {message && (
            <div role="status" aria-live="polite" className="msf-setup-status border-t border-border/70 px-6 py-3 text-sm">
              {message}
            </div>
          )}
        </GlassSurface>
      </main>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
