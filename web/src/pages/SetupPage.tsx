import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Cpu,
  DownloadCloud,
  Globe2,
  KeyRound,
  Languages,
  Loader2,
  Mail,
  Network,
  Plus,
  Rocket,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserRound,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface NetworkInterface {
  name: string;
  ip?: string;
  primary_ip?: string;
  is_loopback?: boolean;
  is_up?: boolean;
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
}

interface SubscriptionRow {
  tag: string;
  url: string;
}

const defaultForm = {
  username: "",
  password: "",
  confirmPassword: "",
  email: "",
  timezone: "Asia/Shanghai",
  webPort: "7777",
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

const steps = [
  { title: "欢迎", description: "开始配置", icon: Rocket },
  { title: "管理员", description: "创建账户", icon: UserRound },
  { title: "系统设置", description: "基础配置", icon: Settings2 },
  { title: "配置参数", description: "参数设置", icon: SlidersHorizontal },
  { title: "安装组件", description: "选择组件", icon: DownloadCloud },
  { title: "完成", description: "启动系统", icon: CheckCircle2 },
];

const inputClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60";

function networkRows(payload: any): NetworkInterface[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.interfaces)) return payload.interfaces;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={cn("grid gap-2 text-sm font-medium text-foreground", className)}>
      <span>{label}</span>
      {children}
      {hint && <span className="text-xs leading-5 text-muted-foreground">{hint}</span>}
    </label>
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
        "inline-flex h-9 min-w-[80px] items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90"
          : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:bg-muted/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function SetupStepper({
  current,
  onStepClick,
}: {
  current: number;
  onStepClick: (step: number) => void;
}) {
  return (
    <div className="w-full px-8 pb-7 pt-6">
      <div className="flex items-start justify-between">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const active = index === current;
          const done = index < current;
          const last = index === steps.length - 1;
          return (
            <div key={step.title} className="flex min-w-0 flex-1 items-start">
              <button
                type="button"
                onClick={() => onStepClick(index)}
                className="flex min-w-0 flex-1 flex-col items-center border-0 bg-transparent p-0 text-center shadow-none hover:shadow-none"
              >
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition-all",
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
            </div>
          );
        })}
      </div>
    </div>
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
    <section className="overflow-hidden rounded-b-2xl border-t border-border/70 bg-card shadow-apple">
      <div className="h-[388px] overflow-y-auto px-6 py-5">{children}</div>
      <div className="flex h-[66px] items-center justify-between border-t border-border/70 px-6">{footer}</div>
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
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function NumberedLine({
  index,
  title,
  description,
}: {
  index: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {index}
      </span>
      <div>
        <div className="text-xs font-semibold text-foreground">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
    </div>
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
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent p-0 transition-colors",
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
  title,
  description,
  checked,
  onChange,
  children,
}: {
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
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            className="peer sr-only"
          />
          <span className="flex h-4 w-4 items-center justify-center rounded border-2 border-border bg-background transition-all peer-checked:border-primary peer-checked:bg-primary group-hover:border-primary/50">
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
      className={cn(
        "flex min-h-[92px] w-full items-start gap-3 rounded-xl border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60",
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

export function SetupPage() {
  const navigate = useNavigate();
  const { initialized, user, loading, refresh } = useAuth();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [system, setSystem] = useState<SetupSystemInfo | null>(null);
  const [privilege, setPrivilege] = useState<PrivilegeInfo | null>(null);
  const [ifaces, setIfaces] = useState<NetworkInterface[]>([]);
  const [form, setForm] = useState<SetupForm>(defaultForm);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [manualNodes, setManualNodes] = useState<string[]>([]);
  const [nodeMode, setNodeMode] = useState<"share" | "yaml">("share");

  useEffect(() => {
    if (!loading && initialized) {
      navigate(user ? "/" : "/login", { replace: true });
    }
  }, [loading, initialized, user, navigate]);

  useEffect(() => {
    Promise.allSettled([
      api<any>("/api/v1/setup/privilege", { skipAuth: true }),
      api<any>("/api/v1/setup/system-info", { skipAuth: true }),
      api<any>("/api/v1/setup/network-interfaces", { skipAuth: true }),
    ]).then(([privilegeResult, systemResult, networkResult]) => {
      if (privilegeResult.status === "fulfilled") setPrivilege(privilegeResult.value);
      if (systemResult.status === "fulfilled") setSystem(systemResult.value);
      if (networkResult.status === "fulfilled") {
        const rows = networkRows(networkResult.value);
        setIfaces(rows);
        const first = rows.find((item) => item.is_up && !item.is_loopback) || rows[0];
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
  const cpu = `${system?.cpu?.model || "-"} · ${system?.cpu?.cores || "-"} 核`;
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

  const update = (key: keyof SetupForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const setSubscription = (index: number, patch: Partial<SubscriptionRow>) => {
    setSubscriptions((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const setManualNode = (index: number, value: string) => {
    setManualNodes((rows) => rows.map((row, rowIndex) => (rowIndex === index ? value : row)));
  };

  const validateAll = () => {
    const errors: Array<{ step: number; message: string }> = [];
    if (form.username.trim().length < 2) errors.push({ step: 1, message: "管理员用户名至少需要 2 个字符" });
    if (form.password.length < 8) errors.push({ step: 1, message: "管理员密码至少需要 8 位" });
    if (form.password !== form.confirmPassword) errors.push({ step: 1, message: "两次密码不一致" });
    const port = Number(form.webPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push({ step: 2, message: "Web 端口必须在 1-65535 之间" });
    if (!form.selected_interface) errors.push({ step: 3, message: "请选择物理网卡" });
    if (!form.mosdnsEnabled) errors.push({ step: 4, message: "MosDNS 为必选组件" });
    if (form.proxyCore === "none") errors.push({ step: 4, message: "请选择一个代理核心" });
    return errors;
  };

  const completeInitialize = async () => {
    const errors = validateAll();
    if (errors.length > 0) {
      setMessage(errors[0].message);
      setStep(errors[0].step);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await api("/api/v1/setup/initialize", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          subscription_urls: subscriptionText,
          mihomo_proxies: manualProxyText,
        }),
        skipAuth: true,
      });
      await api("/api/v1/setup/activate", { method: "POST", skipAuth: true }).catch(() => null);
      await refresh();
      navigate("/login", { replace: true });
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const go = (nextStep: number) => {
    setMessage("");
    setStep(Math.max(0, Math.min(steps.length - 1, nextStep)));
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
        <SetupPageButton variant="primary" disabled={busy} onClick={() => void completeInitialize()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          完成初始化
        </SetupPageButton>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="fixed right-8 top-6 z-10 flex items-center gap-4 text-muted-foreground">
        <button className="border-0 bg-transparent p-0 shadow-none hover:text-foreground hover:shadow-none" type="button" title="切换主题">
          <Sun className="h-5 w-5" />
        </button>
        <button className="border-0 bg-transparent p-0 shadow-none hover:text-foreground hover:shadow-none" type="button" title="语言">
          <Languages className="h-5 w-5" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-[896px] px-2 pb-8 pt-10">
        <header className="flex items-center gap-3 px-7">
          <img src="/logo/logo-square.svg" alt="MSM" className="h-9 w-9" />
          <h1 className="text-xl font-bold tracking-normal text-foreground">MSM 初始化向导</h1>
        </header>

        <div className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-apple-lg">
          <SetupStepper current={step} onStepClick={go} />
          <SetupCard footer={footer}>
            {step === 0 && (
              <div className="mx-auto max-w-md space-y-4 py-1 text-center">
                <StepIcon icon={Rocket} />
                <div>
                  <h2 className="text-lg font-bold text-foreground">欢迎使用 MSM 管理平台</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Mosdns · Singbox · Mihomo Manager</p>
                </div>
                {privilege && (
                  <div
                    className={cn(
                      "rounded-lg border p-3 text-left text-xs",
                      privilege.is_root
                        ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
                        : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {privilege.is_root ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <Circle className="mt-0.5 h-4 w-4" />}
                      <div>
                        <div className="font-medium">{privilege.is_root ? "权限检查通过" : "权限检查未通过"}</div>
                        <div className="mt-0.5">
                          {privilege.is_root ? "服务以 sudo/root 权限运行，可以继续配置" : privilege.message || "MosDNS 53 端口和 nftables 需要管理员权限"}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="space-y-3 text-left">
                  <NumberedLine index={1} title="创建管理员账户" description="设置您的管理员用户名和密码" />
                  <NumberedLine index={2} title="配置系统设置" description="设置时区、端口等基础配置" />
                  <NumberedLine index={3} title="配置组件参数" description="设置CPU优化、网络接口和DNS等" />
                  <NumberedLine index={4} title="选择安装服务" description="选择需要安装的服务组件" />
                  <NumberedLine index={5} title="完成初始化" description="确认配置并启动系统" />
                </div>
                <p className="text-xs text-muted-foreground">⚡ 60秒极速完成</p>
              </div>
            )}

            {step === 1 && (
              <div className="mx-auto max-w-2xl space-y-6">
                <div className="text-center">
                  <StepIcon icon={UserRound} />
                  <h2 className="mt-3 text-lg font-bold">创建管理员账户</h2>
                  <p className="mt-1 text-xs text-muted-foreground">请设置您的管理员用户名和密码</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="用户名">
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        className={cn(inputClass, "pl-9")}
                        placeholder="请输入管理员用户名"
                        value={form.username}
                        onChange={(event) => update("username", event.target.value)}
                      />
                    </div>
                  </Field>
                  <Field label="邮箱（可选）">
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        className={cn(inputClass, "pl-9")}
                        type="email"
                        placeholder="请输入邮箱地址"
                        value={form.email}
                        onChange={(event) => update("email", event.target.value)}
                      />
                    </div>
                  </Field>
                  <Field label="密码">
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        className={cn(inputClass, "pl-9")}
                        type="password"
                        placeholder="请输入密码（至少8位）"
                        value={form.password}
                        onChange={(event) => update("password", event.target.value)}
                      />
                    </div>
                  </Field>
                  <Field label="确认密码">
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        className={cn(inputClass, "pl-9")}
                        type="password"
                        placeholder="请再次输入密码"
                        value={form.confirmPassword}
                        onChange={(event) => update("confirmPassword", event.target.value)}
                      />
                    </div>
                  </Field>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="mx-auto max-w-2xl space-y-5">
                <div className="text-center">
                  <StepIcon icon={Settings2} />
                  <h2 className="mt-3 text-lg font-bold">系统设置</h2>
                  <p className="mt-1 text-xs text-muted-foreground">配置基础系统参数</p>
                </div>
                <Field label="时区">
                  <select className={inputClass} value={form.timezone} onChange={(event) => update("timezone", event.target.value)}>
                    <option value="Asia/Shanghai">Asia/Shanghai (中国)</option>
                    <option value="UTC">UTC (协调世界时)</option>
                  </select>
                </Field>
                <Field label="Web 管理端口" hint="默认端口：7777，可使用 1-65535 之间的任意端口（1-1023 为特权端口，需要管理员权限）">
                  <input className={inputClass} value={form.webPort} onChange={(event) => update("webPort", event.target.value)} />
                </Field>
                <ToggleRow
                  title="启用 HTTPS"
                  description="需要配置 SSL 证书"
                  checked={form.enableHttps}
                  disabled
                  onChange={(checked) => update("enableHttps", checked)}
                  badge={<Badge>开发中</Badge>}
                />
              </div>
            )}

            {step === 3 && (
                <div className="mx-auto max-w-[832px] space-y-3">
                  <div className="text-center">
                    <StepIcon icon={SlidersHorizontal} />
                    <h2 className="mt-3 text-lg font-bold">组件设置</h2>
                    <p className="mt-1 text-xs text-muted-foreground">配置组件参数（可跳过，后续可在配置管理中手动调整）</p>
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
                            className={cn(inputClass, "mt-3 h-8 text-xs")}
                            value={form.selected_interface}
                            onChange={(event) => update("selected_interface", event.target.value)}
                          >
                            {ifaces.length === 0 && <option value="">请选择网络接口</option>}
                            {ifaces.map((iface) => (
                              <option key={iface.name} value={iface.name}>
                                {iface.name} - {iface.primary_ip || iface.ip || "-"} {iface.speed ? `(${iface.speed})` : ""}
                              </option>
                            ))}
                          </select>
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
                          <div className="text-xs font-semibold">自动修改本机 DNS</div>
                          <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                            开启后自动将系统 DNS 切换为 mosdns（127.0.0.1），关闭则仅生成配置不改动系统 DNS
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => update("auto_set_dns", !form.auto_set_dns)}
                          className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0", form.auto_set_dns ? "bg-primary" : "bg-muted")}
                          aria-label="自动修改本机 DNS"
                          aria-pressed={form.auto_set_dns}
                        >
                          <span className={cn("pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", form.auto_set_dns ? "translate-x-5" : "translate-x-0")} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="服务启动后本机 DNS" hint="服务启动后系统将使用的 DNS 地址，默认 127.0.0.1">
                        <input className={cn(inputClass, "h-8 text-xs")} value={form.dns_on} onChange={(event) => update("dns_on", event.target.value)} />
                      </Field>
                      <Field label="服务停止后本机 DNS" hint="服务停止后恢复的 DNS 地址，默认 223.5.5.5">
                        <input className={cn(inputClass, "h-8 text-xs")} value={form.dns_off} onChange={(event) => update("dns_off", event.target.value)} />
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
                      title="启用 IPv6"
                      description="开启后代理核心将支持 IPv6 流量处理，关闭则仅处理 IPv4 流量。如果您的网络不支持 IPv6，请务必关闭此选项"
                      checked={form.enableIPv6}
                      onChange={(checked) => update("enableIPv6", checked)}
                    />
                    <div className="mt-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
                      ⚠️ 请确认您的网络环境支持 IPv6 · https://test-ipv6.com
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
                        <input className={cn(inputClass, "h-8 text-xs")} value={form.fakeIPRangeV4} onChange={(event) => update("fakeIPRangeV4", event.target.value)} />
                      </Field>
                      <Field label="IPv6 Fake-IP 网段" hint="默认使用 f2b0::/18 网段，仅在启用 IPv6 时生效">
                        <input className={cn(inputClass, "h-8 text-xs")} value={form.fakeIPRangeV6} onChange={(event) => update("fakeIPRangeV6", event.target.value)} />
                      </Field>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">💡 提示：Fake-IP 网段修改功能正在开发中，当前仅支持查看默认配置</p>
                  </div>
                </div>
              )}

              {step === 4 && (
              <div className="mx-auto max-w-[832px] space-y-3">
                <div className="text-center">
                  <StepIcon icon={DownloadCloud} />
                  <h2 className="mt-3 text-lg font-bold">选择安装组件</h2>
                  <p className="mt-1 text-xs text-muted-foreground">MosDNS 为必选项,代理核心二选一</p>
                </div>
                <button
                  type="button"
                  onClick={() => update("mosdnsEnabled", true)}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-lg border border-cyan-500 bg-cyan-50/70 px-4 text-left dark:bg-cyan-500/10"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Server className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">MosDNS</span>
                    <span className="block text-xs text-muted-foreground">DNS 服务器，提供 DNS 分流和广告过滤功能</span>
                  </span>
                  <Badge tone="success">必选</Badge>
                  <CheckCircle2 className="h-4 w-4 text-cyan-600" />
                </button>
                <div>
                  <div className="text-sm font-semibold">代理核心选择（二选一）</div>
                  <p className="mt-1 text-xs text-muted-foreground">Sing-box 和 Mihomo 只能选择其中一个</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled
                      className="flex min-h-[108px] items-start gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left opacity-60"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Globe2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          Sing-box <Badge>开发中</Badge>
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">通用代理平台，支持多种协议</span>
                      </span>
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      onClick={() => update("proxyCore", "mihomo")}
                      className="flex min-h-[108px] items-start gap-3 rounded-lg border border-cyan-500 bg-cyan-50/70 px-4 py-3 text-left dark:bg-cyan-500/10"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <ShieldCheck className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">Mihomo</span>
                        <span className="mt-1 block text-xs text-muted-foreground">通用代理平台，支持多种协议</span>
                        <span className="mt-3 block border-t border-border pt-3">
                          <span className="mb-2 block text-xs text-muted-foreground">Mihomo Core</span>
                          <span className="flex gap-2">
                            {["meta", "alpha"].map((core) => (
                              <span
                                key={core}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  update("mihomo_core_type", core);
                                }}
                                className={cn(
                                  "rounded-md px-3 py-1.5 text-xs font-medium",
                                  form.mihomo_core_type === core ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                                )}
                              >
                                {core}
                              </span>
                            ))}
                          </span>
                        </span>
                      </span>
                      <Circle className="h-4 w-4 fill-primary text-primary" />
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <SlidersHorizontal className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-sm font-semibold">Linux 透明代理</div>
                      <div className="text-xs text-muted-foreground">Linux 透明代理配置</div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-2 text-sm font-medium">Linux 透明代理模式</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <ChoiceCard
                          title="nftables 转发（TProxy + Redirect）"
                          description="Linux 下 Mihomo 支持 nftables 转发，默认使用 nftables 转发。"
                          selected={form.linux_proxy_mode === "nft"}
                          onClick={() => update("linux_proxy_mode", "nft")}
                        />
                        <ChoiceCard
                          title="TUN 模式"
                          description="使用 TUN 虚拟网卡处理流量。"
                          selected={form.linux_proxy_mode === "tun"}
                          onClick={() => update("linux_proxy_mode", "tun")}
                        />
                      </div>
                    </div>
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
                  </div>
                </div>
                <SetupSection title="订阅链接" description="机场订阅链接">
                  <div className="space-y-3">
                    {subscriptions.map((row, index) => (
                      <div key={index} className="grid gap-2 sm:grid-cols-[130px_minmax(0,1fr)_auto]">
                        <input
                          className={inputClass}
                          placeholder="名称"
                          value={row.tag}
                          onChange={(event) => setSubscription(index, { tag: event.target.value })}
                        />
                        <input
                          className={inputClass}
                          placeholder="订阅 URL"
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
                        className={cn("rounded-lg border px-3 py-2 text-xs font-medium", nodeMode === "share" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}
                      >
                        分享链接模式
                      </button>
                      <button
                        type="button"
                        onClick={() => setNodeMode("yaml")}
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
                              placeholder="ss:// / trojan:// / vmess:// / vless:// / hysteria2:// / tuic:// ..."
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
                          value={form.mihomo_proxies}
                          onChange={(event) => update("mihomo_proxies", event.target.value)}
                          placeholder={'proxies:\n  - name: "my-node"\n    type: trojan\n    server: example.com\n    port: 443\n    password: "xxx"\n    sni: example.com'}
                        />
                        <span className="text-xs text-muted-foreground">已添加 {manualNodeCount} 组 YAML 配置</span>
                      </div>
                    )}
                  </div>
                </SetupSection>
                <SetupSection title="GitHub 下载加速（可选）" description="可同时配置多种加速方式,留空则直连下载">
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <CheckOption
                      title="代理服务器"
                      description="使用 HTTP/HTTPS/SOCKS5 代理下载组件"
                      checked={form.github_proxy_enabled}
                      onChange={(checked) => update("github_proxy_enabled", checked)}
                      >
                        <div className="space-y-1 pl-0.5">
                        <input
                            className={cn(inputClass, "h-8 text-xs")}
                            placeholder="HTTPS 代理，例如 http://127.0.0.1:7890"
                            value={form.github_https_proxy}
                            onChange={(event) => update("github_https_proxy", event.target.value)}
                        />
                        <input
                            className={cn(inputClass, "h-8 text-xs")}
                            placeholder="HTTP 代理，例如 http://127.0.0.1:7890"
                            value={form.github_http_proxy}
                            onChange={(event) => update("github_http_proxy", event.target.value)}
                        />
                        <input
                            className={cn(inputClass, "h-8 text-xs")}
                            placeholder="SOCKS5 代理，例如 socks5://127.0.0.1:7891"
                            value={form.github_socks5_proxy}
                            onChange={(event) => update("github_socks5_proxy", event.target.value)}
                        />
                      </div>
                      </CheckOption>
                      <CheckOption
                      title="加速代理"
                      description="使用 GitHub 加速镜像下载组件"
                      checked={form.github_accelerator_enabled}
                      onChange={(checked) => update("github_accelerator_enabled", checked)}
                      >
                        <div className="space-y-2 pl-0.5">
                        <input
                            className={cn(inputClass, "h-8 text-xs")}
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
                    <p className="text-xs leading-5 text-muted-foreground">💡 此配置仅用于下载过程,安装完成后会自动清除,不影响代理服务本身的运行</p>
                  </div>
                </SetupSection>
              </div>
            )}

            {step === 5 && (
              <div className="mx-auto max-w-md space-y-6 py-4 text-center">
                <StepIcon icon={CheckCircle2} />
                <div>
                  <h2 className="text-lg font-bold text-foreground">准备就绪！</h2>
                  <p className="mt-2 text-xs text-muted-foreground">点击完成按钮开始初始化系统</p>
                </div>
                <div className="rounded-xl border border-border bg-background p-4 text-left">
                  <h3 className="mb-4 text-sm font-semibold">配置摘要：</h3>
                  <SummaryRow label="管理员用户名" value={form.username || "root"} />
                  <SummaryRow label="时区" value={form.timezone} />
                  <SummaryRow label="Web 端口" value={form.webPort} />
                  <SummaryRow label="HTTPS" value={form.enableHttps ? "启用" : "禁用"} />
                  <SummaryRow label="MosDNS" value={form.mosdnsEnabled ? "启用" : "禁用"} />
                  <SummaryRow label="代理核心" value={form.proxyCore === "mihomo" ? "Mihomo" : form.proxyCore} />
                  <SummaryRow label="自定义节点" value={manualNodeCount > 0 ? `${manualNodeCount} 条/组` : "未配置"} />
                  <SummaryRow label="GitHub 加速" value={form.github_proxy_enabled || form.github_accelerator_enabled ? "已配置" : "未配置"} />
                </div>
              </div>
            )}
          </SetupCard>
          {message && (
            <div className="border-t border-border/70 bg-yellow-50 px-6 py-3 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">
              {message}
            </div>
          )}
        </div>
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
