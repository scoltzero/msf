"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  Unlock,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassField } from "@/components/liquid-glass/GlassField";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import { useToaster, ToastStack } from "@/components/Toaster";
import {
  CreateUserDialog,
  DeleteUserDialog,
  EditUserDialog,
  ResetPasswordDialog,
  ROLE_LABEL,
  type User,
} from "@/components/users/UserDialogs";
import { cn } from "@/lib/utils";
import { api, apiList } from "@/lib/api";

const initialUsers: User[] = [
  {
    id: "1",
    username: "root",
    display: "root",
    email: "",
    role: "admin",
    enabled: true,
    lastLogin: "2026/06/01 21:52",
  },
];

type UserStats = {
  total: number;
  admin: number;
  active: number;
  inactive: number;
};

const initialStats: UserStats = { total: 1, admin: 1, active: 1, inactive: 0 };

function toUserStats(value: any): UserStats {
  const roles = value?.roles || {};
  return {
    total: Number(value?.total || 0),
    admin: Number(value?.admin ?? roles.admin ?? 0),
    active: Number(value?.active || 0),
    inactive: Number(value?.inactive ?? value?.disabled ?? 0),
  };
}

function toUser(row: any): User {
  const last = row.last_login || row.lastLogin;
  return {
    id: String(row.id),
    username: String(row.username || ""),
    display: String(row.display_name || row.display || row.username || ""),
    email: String(row.email || ""),
    role: (row.role || "operator") as User["role"],
    enabled: Boolean(row.is_active ?? row.enabled ?? true),
    lastLogin: last ? new Date(last).toLocaleString() : "从未登录",
  };
}

const roleColors: Record<User["role"], string> = {
  admin: "bg-primary text-primary-foreground",
  operator: "bg-secondary text-secondary-foreground",
  viewer: "border border-border bg-background text-foreground",
  guest: "border border-border bg-background text-foreground",
};

const roleCards: Array<{
  role: User["role"];
  code: string;
  icon: ReactNode;
  tone: string;
  permissions: Array<{ text: string; allowed: boolean }>;
}> = [
  {
    role: "admin",
    code: "admin",
    icon: <Shield className="h-5 w-5" />,
    tone: "text-blue-500 bg-blue-500/10",
    permissions: [
      { text: "完全的系统访问权限", allowed: true },
      { text: "管理用户和权限", allowed: true },
      { text: "修改系统配置", allowed: true },
      { text: "启动/停止服务", allowed: true },
      { text: "查看和导出所有日志", allowed: true },
    ],
  },
  {
    role: "operator",
    code: "operator",
    icon: <Users className="h-5 w-5" />,
    tone: "text-purple-500 bg-purple-500/10",
    permissions: [
      { text: "管理服务(启动/停止/重启)", allowed: true },
      { text: "编辑配置文件", allowed: true },
      { text: "查看日志和监控数据", allowed: true },
      { text: "配置历史回滚", allowed: false },
      { text: "无法管理用户和系统设置", allowed: false },
    ],
  },
  {
    role: "viewer",
    code: "viewer",
    icon: <UserRound className="h-5 w-5" />,
    tone: "text-green-500 bg-green-500/10",
    permissions: [
      { text: "查看服务状态", allowed: true },
      { text: "查看配置文件(只读)", allowed: true },
      { text: "查看日志", allowed: false },
      { text: "无法修改任何配置", allowed: false },
    ],
  },
  {
    role: "guest",
    code: "guest",
    icon: <KeyRound className="h-5 w-5" />,
    tone: "text-orange-500 bg-orange-500/10",
    permissions: [
      { text: "查看基本系统信息", allowed: true },
      { text: "查看服务状态", allowed: false },
      { text: "查看部分日志", allowed: false },
      { text: "无法访问敏感配置", allowed: false },
    ],
  },
];

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <SolidPlate tone="regular" className="min-w-0 rounded-[14px] p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-2xl font-bold leading-none tabular-nums text-foreground">{value}</p>
        </div>
        <div className={cn("rounded-[12px] p-2.5 [&>svg]:h-5 [&>svg]:w-5", tone)}>{icon}</div>
      </div>
    </SolidPlate>
  );
}

function UserCard({
  user,
  onEdit,
  onResetPassword,
  onToggleActive,
  onDelete,
}: {
  user: User;
  onEdit: (user: User) => void;
  onResetPassword: (user: User) => void;
  onToggleActive: (id: string) => void;
  onDelete: (user: User) => void;
}) {
  const isRoot = user.id === "1";
  const initial = (user.display || user.username).slice(0, 1).toUpperCase();

  return (
    <SolidPlate tone="regular" className="group overflow-hidden rounded-[16px] transition-[border-color,box-shadow] duration-200 hover:border-primary/35 hover:shadow-sm">
      <div className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-500 text-base font-bold text-white shadow-sm">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <h3 className="text-base font-semibold text-foreground">
                {user.display || user.username}
              </h3>
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", roleColors[user.role])}>
                {ROLE_LABEL[user.role]}
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  user.enabled
                    ? "bg-green-600 text-white dark:bg-green-500"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {user.enabled ? "已启用" : "已禁用"}
              </span>
              {isRoot ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  内置账号
                </span>
              ) : null}
            </div>
            <div className="space-y-0.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <UserRound className="h-3.5 w-3.5" />
                <span className="font-mono">@{user.username}</span>
              </div>
              {user.email && <div>{user.email}</div>}
              <div className="text-xs">最后登录: {user.lastLogin}</div>
            </div>
          </div>
          <div className="ml-auto grid shrink-0 grid-cols-4 gap-2 sm:grid-cols-2">
            <button
              onClick={() => onEdit(user)}
              className="gary-icon-button h-9 w-9 rounded-[10px] text-muted-foreground hover:text-foreground"
              aria-label="编辑用户"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => onResetPassword(user)}
              className="gary-icon-button h-9 w-9 rounded-[10px] text-muted-foreground hover:text-foreground"
              aria-label="重置密码"
            >
              <KeyRound className="h-4 w-4" />
            </button>
            <button
              onClick={() => onToggleActive(user.id)}
              className="gary-icon-button h-9 w-9 rounded-[10px] text-muted-foreground hover:text-foreground"
              aria-label={user.enabled ? "禁用用户" : "启用用户"}
            >
              {user.enabled ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            </button>
            <button
              onClick={() => onDelete(user)}
              disabled={isRoot}
              className="gary-icon-button h-9 w-9 rounded-[10px] text-muted-foreground hover:border-destructive/35 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground"
              aria-label="删除用户"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </SolidPlate>
  );
}

export function UsersSettingsPanel() {
  const { toasts, showToast } = useToaster();
  const [users, setUsers] = useState(initialUsers);
  const [stats, setStats] = useState<UserStats>(initialStats);
  const [loading, setLoading] = useState(true);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<User["role"] | "all">("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [pageSize, setPageSize] = useState(20);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (role !== "all") params.set("role", role);
      if (status !== "all") params.set("status", status === "active" ? "active" : "inactive");
      params.set("page_size", String(pageSize));
      const payload = await api<any>(`/api/v1/users?${params}`);
      setUsers(apiList<any>(payload, ["users", "data"]).map(toUser));
      setStats(toUserStats(payload.stats));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [search, role, status, pageSize]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((user) => {
      const haystack = `${user.username} ${user.display} ${user.email}`.toLowerCase();
      return (
        (!q || haystack.includes(q)) &&
        (role === "all" || user.role === role) &&
        (status === "all" || (status === "active" ? user.enabled : !user.enabled))
      );
    });
  }, [users, search, role, status]);

  return (
    <>
      <div className="space-y-3 pb-3 animate-fade-in">
        <GlassSurface material="thick" className="rounded-[24px] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-[12px] bg-primary/10 p-2.5 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-5 text-foreground">用户管理</h1>
                <p className="mt-0.5 text-xs text-muted-foreground">管理系统用户、账号状态与角色权限</p>
              </div>
            </div>
            <GlassButton type="button" variant="primary" onClick={() => setCreateOpen(true)} className="h-9 self-start px-3 text-sm md:self-auto">
              <Plus className="h-4 w-4" />
              创建用户
            </GlassButton>
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="总用户数" value={stats.total} icon={<Users className="h-6 w-6" />} tone="bg-blue-500/10 text-blue-500" />
            <StatCard label="管理员" value={stats.admin} icon={<Shield className="h-6 w-6" />} tone="bg-purple-500/10 text-purple-500" />
            <StatCard label="启用用户" value={stats.active} icon={<CheckCircle2 className="h-6 w-6" />} tone="bg-green-500/10 text-green-500" />
            <StatCard label="禁用用户" value={stats.inactive} icon={<XCircle className="h-6 w-6" />} tone="bg-orange-500/10 text-orange-500" />
          </div>
        </GlassSurface>

        <GlassSurface material="thick" className="rounded-[24px]">
          <div className="border-b border-border/50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <h2 className="text-lg font-semibold text-foreground">用户管理</h2>
              <div className="ml-auto flex w-full flex-col gap-2 md:w-auto md:flex-row">
                <div className="relative flex-1 md:min-w-[260px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <GlassField
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setSearch(searchDraft);
                    }}
                    placeholder="搜索用户名、邮箱或显示名称..."
                    className="h-9 w-full rounded-[10px] pl-9 pr-16 text-sm"
                  />
                  <button
                    onClick={() => setSearch(searchDraft)}
                    className="gary-glass-button gary-glass-button--tool absolute right-1 top-1/2 min-h-7 -translate-y-1/2 rounded-[8px] px-2 text-xs"
                  >
                    搜索
                  </button>
                </div>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as User["role"] | "all")}
                  className="gary-solid-plate gary-solid-plate--regular h-9 rounded-[10px] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/55"
                >
                  <option value="all">所有角色</option>
                  <option value="admin">管理员</option>
                  <option value="operator">运维人员</option>
                  <option value="viewer">只读用户</option>
                  <option value="guest">访客</option>
                </select>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "all" | "active" | "inactive")}
                  className="gary-solid-plate gary-solid-plate--regular h-9 rounded-[10px] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/55"
                >
                  <option value="all">所有状态</option>
                  <option value="active">已启用</option>
                  <option value="inactive">已禁用</option>
                </select>
              </div>
            </div>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">正在加载用户...</div>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">没有匹配的用户</div>
            ) : (
              <div className={cn("grid grid-cols-1 gap-3", filtered.length > 1 && "xl:grid-cols-2")}>
                {filtered.map((user) => (
                  <UserCard
                    key={user.id}
                    user={user}
                    onEdit={setEditing}
                    onResetPassword={setResetting}
                    onToggleActive={(id) => {
                      const target = users.find((item) => item.id === id);
                      if (!target) return;
                      api(`/api/v1/users/${id}`, {
                        method: "PUT",
                        body: JSON.stringify({
                          email: target.email,
                          display_name: target.display,
                          role: target.role,
                          is_active: !target.enabled,
                        }),
                      })
                        .then(() => {
                          showToast("用户状态已更新");
                          void loadUsers();
                        })
                        .catch((err) => showToast(err instanceof Error ? err.message : String(err)));
                    }}
                    onDelete={setDeleting}
                  />
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3 text-xs text-muted-foreground md:flex-row md:items-center">
              <div>共 {filtered.length} 个用户，当前第 1 / 1 页</div>
              <div className="flex items-center gap-2 md:ml-auto">
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                >
                  {[10, 20, 50, 100].map((n) => (
                    <option key={n} value={n}>{n}/页</option>
                  ))}
                </select>
                <button disabled className="rounded-md border border-border px-3 py-1.5 opacity-50">上一页</button>
                <div className="px-2 text-xs">1 / 1</div>
                <button disabled className="rounded-md border border-border px-3 py-1.5 opacity-50">下一页</button>
              </div>
            </div>
          </div>
        </GlassSurface>

        <GlassSurface material="thick" className="rounded-[24px] p-4">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-foreground">角色权限对比</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">集中查看不同角色可执行的操作范围</p>
          </div>
          <SolidPlate tone="regular" className="grid gap-px overflow-hidden rounded-[16px] bg-border/45 xl:grid-cols-2 2xl:grid-cols-4">
            {roleCards.map((card) => (
              <section key={card.role} className="bg-[var(--gary-plate-display-fill-regular)] p-3">
                <div className="mb-2.5 flex items-center gap-2.5">
                  <div className={cn("rounded-lg p-1.5 [&>svg]:h-4 [&>svg]:w-4", card.tone)}>{card.icon}</div>
                  <div>
                    <div className="font-semibold text-foreground">{ROLE_LABEL[card.role]}</div>
                    <div className="mt-1">
                      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", roleColors[card.role])}>{card.code}</span>
                    </div>
                  </div>
                </div>
                <ul className="space-y-1">
                  {card.permissions.map((permission) => (
                    <li key={permission.text} className="flex items-start gap-1.5 text-xs leading-4">
                      <span className={permission.allowed ? "text-green-500" : "text-muted-foreground"}>
                        {permission.allowed ? "✓" : "×"}
                      </span>
                      <span className={permission.allowed ? "text-foreground" : "text-muted-foreground"}>
                        {permission.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </SolidPlate>
        </GlassSurface>
      </div>

      {createOpen && (
        <CreateUserDialog
          onClose={() => setCreateOpen(false)}
          onCreate={(user) => {
            api("/api/v1/users", {
              method: "POST",
              body: JSON.stringify({
                username: user.username,
                password: user.password,
                email: user.email,
                display_name: user.display,
                role: user.role,
              }),
            })
              .then(() => {
                setCreateOpen(false);
                showToast("用户已创建");
                void loadUsers();
              })
              .catch((err) => showToast(err instanceof Error ? err.message : String(err)));
          }}
        />
      )}
      {editing && (
        <EditUserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            api(`/api/v1/users/${editing.id}`, {
              method: "PUT",
              body: JSON.stringify({
                email: patch.email ?? editing.email,
                display_name: patch.display ?? editing.display,
                role: patch.role ?? editing.role,
                is_active: editing.enabled,
              }),
            })
              .then(() => {
                setEditing(null);
                showToast("用户已保存");
                void loadUsers();
              })
              .catch((err) => showToast(err instanceof Error ? err.message : String(err)));
          }}
        />
      )}
      {resetting && (
        <ResetPasswordDialog
          user={resetting}
          onClose={() => setResetting(null)}
          onReset={(password) => {
            api(`/api/v1/users/${resetting.id}/reset-password`, {
              method: "POST",
              body: JSON.stringify({ password }),
            })
              .then(() => {
                setResetting(null);
                showToast("密码已重置");
              })
              .catch((err) => showToast(err instanceof Error ? err.message : String(err)));
          }}
        />
      )}
      {deleting && (
        <DeleteUserDialog
          user={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            api(`/api/v1/users/${deleting.id}`, { method: "DELETE" })
              .then(() => {
                setDeleting(null);
                showToast("用户已删除");
                void loadUsers();
              })
              .catch((err) => showToast(err instanceof Error ? err.message : String(err)));
          }}
        />
      )}
      <ToastStack toasts={toasts} />
    </>
  );
}

export default function UsersPage() {
  return (
    <AppShell>
      <UsersSettingsPanel />
    </AppShell>
  );
}
