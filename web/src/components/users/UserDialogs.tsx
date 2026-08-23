"use client";

import { useState } from "react";
import { X, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";

export interface User {
  id: string;
  username: string;
  display: string;
  email: string;
  role: "admin" | "operator" | "viewer" | "guest";
  enabled: boolean;
  lastLogin: string;
}

export const ROLE_OPTIONS: { value: User["role"]; label: string }[] = [
  { value: "admin", label: "管理员 - admin" },
  { value: "operator", label: "运维人员 - operator" },
  { value: "viewer", label: "只读用户 - viewer" },
  { value: "guest", label: "访客 - guest" },
];

export const ROLE_LABEL: Record<User["role"], string> = {
  admin: "管理员",
  operator: "运维人员",
  viewer: "只读用户",
  guest: "访客",
};

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <ModalViewport onClose={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="relative bg-background rounded-xl shadow-2xl p-6 max-w-md w-full animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </ModalViewport>
  );
}

const labelCls = "block text-sm font-medium text-foreground mb-1.5";
const inputCls =
  "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 transition-all";

export function CreateUserDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (u: Omit<User, "id" | "lastLogin"> & { password: string }) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [display, setDisplay] = useState("");
  const [role, setRole] = useState<User["role"]>("operator");
  const [showPw, setShowPw] = useState(false);

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-foreground">创建用户</h2>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>用户名 *</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入用户名" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>
            密码 <span className="text-xs text-muted-foreground font-normal">(至少8位，包含大小写字母和数字)</span> *
          </label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              className={inputCls + " pr-10"}
            />
            <button onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" type="button">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className={labelCls}>邮箱</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>显示名称</label>
          <input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="用户的显示名称" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>角色 *</label>
          <select value={role} onChange={(e) => setRole(e.target.value as User["role"])} className={inputCls}>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <button
          onClick={() => onCreate({ username: username || "newuser", password, display: display || username || "新用户", email, role, enabled: true })}
          className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          创建用户
        </button>
        <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted transition-colors">
          取消
        </button>
      </div>
    </Overlay>
  );
}

export function EditUserDialog({
  user,
  onClose,
  onSave,
}: {
  user: User;
  onClose: () => void;
  onSave: (patch: Partial<User>) => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [display, setDisplay] = useState(user.display);
  const [role, setRole] = useState<User["role"]>(user.role);

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-foreground">编辑用户</h2>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">@{user.username}</p>
      <div className="space-y-3">
        <div>
          <label className={labelCls}>邮箱</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>角色</label>
          <select value={role} onChange={(e) => setRole(e.target.value as User["role"])} className={inputCls}>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>显示名称</label>
          <input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="用户的显示名称" className={inputCls} />
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <button onClick={() => onSave({ email, display, role })} className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          保存
        </button>
        <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted transition-colors">
          取消
        </button>
      </div>
    </Overlay>
  );
}

export function ResetPasswordDialog({
  user,
  onClose,
  onReset,
}: {
  user: User;
  onClose: () => void;
  onReset: (password: string) => void;
}) {
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-foreground">重置密码</h2>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-3">@{user.username}</p>
      <div className="text-sm text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 mb-4">
        重置密码后,用户需要使用新密码重新登录
      </div>
      <div>
        <label className={labelCls}>新密码 <span className="text-xs text-muted-foreground font-normal">(至少8位)</span> *</label>
        <div className="relative">
          <input
            type={showPw ? "text" : "password"}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="密码至少需要8位字符"
            className={inputCls + " pr-10"}
          />
          <button onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" type="button">
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <button onClick={() => onReset(pw)} className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          重置密码
        </button>
        <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted transition-colors">
          取消
        </button>
      </div>
    </Overlay>
  );
}

export function DeleteUserDialog({
  user,
  onClose,
  onConfirm,
}: {
  user: User;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">删除用户</h2>
          <p className="text-sm text-muted-foreground mt-1">
            确定要删除用户 <span className="font-medium text-foreground">@{user.username}</span> 吗？此操作无法撤销。
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onConfirm} className="flex-1 px-4 py-2 rounded-lg bg-destructive text-white text-sm font-medium hover:bg-destructive/90 transition-colors">
          删除
        </button>
        <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted transition-colors">
          取消
        </button>
      </div>
    </Overlay>
  );
}
