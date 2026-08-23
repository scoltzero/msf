"use client";

import { useEffect, useState } from "react";
import { Check, Globe2, KeyRound, Trash2, X } from "lucide-react";
import { GlassButton } from "@/components/liquid-glass/GlassButton";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { ModalViewport } from "@/components/liquid-glass/ModalViewport";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";
import type { UpstreamGroup, UpstreamServer } from "@/lib/mosdns-system-data";

export type UpstreamServerFormValues = {
  name: string;
  protocol: string;
  address: string;
  enabled: boolean;
  accountId: string;
  accessKeyId: string;
  accessKeySecret: string;
  accessKeySecretSet: boolean;
  ecsClientMask: number;
};

type DialogMode = "add" | "edit";

const protocolOptions = ["udp", "tcp", "tls", "https", "quic", "h3", "aliapi"];

const inputCls =
  "gary-field h-10 w-full px-3 text-sm text-foreground placeholder:text-muted-foreground/55";

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
  const [accountId, setAccountId] = useState(server?.accountId || "");
  const [accessKeyId, setAccessKeyId] = useState(server?.accessKeyId || "");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [ecsClientMask, setEcsClientMask] = useState(server?.ecsClientMask ?? 32);
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
  const isAliAPI = protocol === "aliapi";
  const secretAvailable = Boolean(accessKeySecret.trim() || server?.accessKeySecretSet);
  const canSubmit = Boolean(
    name.trim() && address.trim() && protocol.trim() &&
      (!isAliAPI || (accountId.trim() && accessKeyId.trim() && secretAvailable && ecsClientMask >= 0 && ecsClientMask <= 128))
  );

  const submit = () => {
    if (!canSubmit) {
      setError(isAliAPI ? "请完整填写账户 ID、Access Key、服务器地址和有效的 ECS Mask" : "名称、协议和地址不能为空");
      return;
    }
    onSave({
      name: name.trim(),
      protocol: protocol.trim().toLowerCase(),
      address: address.trim(),
      enabled,
      accountId: accountId.trim(),
      accessKeyId: accessKeyId.trim(),
      accessKeySecret: accessKeySecret.trim(),
      accessKeySecretSet: Boolean(server?.accessKeySecretSet),
      ecsClientMask,
    });
  };

  return (
    <ModalViewport onClose={onClose}>
      <GlassSurface material="thick" role="dialog" aria-modal="true" className="relative max-h-[calc(100dvh-2rem)] w-full max-w-[600px] animate-scale-in overflow-hidden rounded-2xl">
        <div className="relative px-5 py-5">
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="absolute right-5 top-5 z-20 rounded-md p-1 text-foreground/80 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="relative z-10">
            <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <div className="max-h-[calc(92vh-168px)] space-y-5 overflow-y-auto px-5 py-5">
          <label className="gary-solid-plate gary-solid-plate--subtle flex items-center gap-3 rounded-xl px-4 py-3">
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
                onChange={(event) => {
                  const nextProtocol = event.target.value;
                  setProtocol(nextProtocol);
                  if (nextProtocol === "aliapi" && protocol !== "aliapi") setAddress("223.5.5.5");
                  setError("");
                }}
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

          <SolidPlate tone="regular" className="rounded-xl px-4 py-4">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              {isAliAPI ? <KeyRound className="h-4 w-4 text-primary" /> : <Globe2 className="h-4 w-4 text-primary" />}
              {isAliAPI ? "阿里云 API 配置" : "上游服务器配置"}
            </div>
            {isAliAPI ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">账户 ID <span className="text-destructive">*</span></label>
                  <input value={accountId} onChange={(event) => { setAccountId(event.target.value); setError(""); }} autoComplete="username" className={inputCls} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">Access Key ID <span className="text-destructive">*</span></label>
                  <input value={accessKeyId} onChange={(event) => { setAccessKeyId(event.target.value); setError(""); }} autoComplete="off" className={inputCls} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">Access Key Secret <span className="text-destructive">*</span></label>
                  <input
                    type="password"
                    value={accessKeySecret}
                    onChange={(event) => { setAccessKeySecret(event.target.value); setError(""); }}
                    placeholder={server?.accessKeySecretSet ? "已设置，留空则保持不变" : "请输入 Access Key Secret"}
                    autoComplete="new-password"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">服务器地址 <span className="text-destructive">*</span></label>
                  <input value={address} onChange={(event) => { setAddress(event.target.value); setError(""); }} placeholder="223.5.5.5" className={inputCls} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">ECS Mask <span className="text-destructive">*</span></label>
                  <input type="number" min={0} max={128} value={ecsClientMask} onChange={(event) => { setEcsClientMask(Number(event.target.value)); setError(""); }} className={inputCls} />
                  <p className="text-xs text-muted-foreground">范围 0–128，通常使用 32</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">地址 <span className="text-destructive">*</span></label>
                <input value={address} onChange={(event) => { setAddress(event.target.value); setError(""); }} placeholder="udp://127.0.0.1:6666" className={inputCls} />
                <p className="text-xs text-muted-foreground">支持 udp://IP 或直接填写 IP 地址</p>
              </div>
            )}
          </SolidPlate>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border/25 px-5 py-4">
          {mode === "edit" && onDelete ? (
            <GlassButton
              variant="danger"
              type="button"
              onClick={onDelete}
              className="h-9 text-sm"
            >
              <Trash2 className="h-4 w-4" />
              删除
            </GlassButton>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <GlassButton
              type="button"
              onClick={onClose}
              className="h-9 px-5 text-sm"
            >
              取消
            </GlassButton>
            <GlassButton
              variant="primary"
              type="button"
              aria-disabled={!canSubmit}
              onClick={submit}
              className="h-9 px-5 text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              {actionLabel}
            </GlassButton>
          </div>
        </div>
      </GlassSurface>
    </ModalViewport>
  );
}
