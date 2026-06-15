"use client";

import { useEffect, useState } from "react";
import { Check, Globe2, Trash2, X } from "lucide-react";
import type { UpstreamGroup, UpstreamServer } from "@/lib/mosdns-system-data";

export type UpstreamServerFormValues = {
  name: string;
  protocol: string;
  address: string;
  enabled: boolean;
};

type DialogMode = "add" | "edit";

const protocolOptions = ["udp", "tcp", "tls", "https", "quic", "h3", "aliapi"];

const inputCls =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/55 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/40";

function displayProtocol(value: string) {
  return value.toUpperCase();
}

function defaultServerName(group: UpstreamGroup) {
  if (group.id === "nocnfake") return "nocnfake";
  if (group.id === "cnfake") return "cnfake";
  return "";
}

export function UpstreamServerDialog({
  mode,
  group,
  server,
  onClose,
  onSave,
  onDelete,
}: {
  mode: DialogMode;
  group: UpstreamGroup;
  server?: UpstreamServer;
  onClose: () => void;
  onSave: (values: UpstreamServerFormValues) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(server?.name || (mode === "add" ? defaultServerName(group) : ""));
  const [protocol, setProtocol] = useState((server?.protocol || "udp").toLowerCase());
  const [address, setAddress] = useState(server?.address || "");
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = mode === "add" ? "添加 上游" : "编辑 上游";
  const actionLabel = mode === "add" ? "添加" : "保存";
  const subtitle = mode === "edit" && name.trim() ? `${group.name} (${name.trim()})` : group.name;
  const canSubmit = Boolean(name.trim() && address.trim() && protocol.trim());

  const submit = () => {
    if (!canSubmit) {
      setError("名称、协议和地址不能为空");
      return;
    }
    onSave({
      name: name.trim(),
      protocol: protocol.trim().toLowerCase(),
      address: address.trim(),
      enabled,
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-[600px] max-h-[92vh] overflow-hidden rounded-lg border border-border bg-background shadow-2xl animate-scale-in">
        <div className="relative overflow-hidden border-b border-border bg-gradient-to-r from-sky-50 via-background to-cyan-50 px-5 py-5 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
          <div className="absolute right-0 top-0 h-28 w-28 rounded-bl-full bg-cyan-400/20" />
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute right-5 top-5 z-10 rounded-md p-1 text-foreground/80 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="relative z-10">
            <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <div className="max-h-[calc(92vh-168px)] space-y-5 overflow-y-auto px-5 py-5">
          <label className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-sm font-semibold text-foreground">启用此上游</span>
            <span className="text-xs text-muted-foreground">启用后才会参与解析</span>
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                名称 / Tag <span className="text-destructive">*</span>
              </label>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
                placeholder={`例如: ${defaultServerName(group) || "custom-upstream"}`}
                className={inputCls}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                协议 <span className="text-destructive">*</span>
              </label>
              <select
                value={protocol}
                onChange={(event) => setProtocol(event.target.value)}
                className={`${inputCls} pr-9`}
              >
                {protocolOptions.map((item) => (
                  <option key={item} value={item}>
                    {displayProtocol(item)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/10 px-4 py-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Globe2 className="h-4 w-4 text-primary" />
              上游服务器配置
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">
                地址 <span className="text-destructive">*</span>
              </label>
              <input
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setError("");
                }}
                placeholder="udp://127.0.0.1:6666"
                className={inputCls}
              />
              <p className="text-xs text-muted-foreground">支持 udp://IP 或直接填写 IP 地址</p>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-background px-5 py-4">
          {mode === "edit" && onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-destructive/40 bg-background px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              取消
            </button>
            <button
              type="button"
              aria-disabled={!canSubmit}
              onClick={submit}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-colors hover:bg-primary/90 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              {actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
