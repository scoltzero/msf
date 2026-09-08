"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { api, apiData } from "@/lib/api";

interface GitHubAccessSnapshot {
  manual_prefix: string;
  current_route: "proxy" | "manual" | "mihomo" | "github";
  probe?: {
    prefix: string;
    ok: boolean;
    latency_ms: number;
    status?: number;
    error?: string;
    probed_at: string;
  } | null;
  github_token_masked: string;
  rate_limit?: {
    limit: number;
    remaining: number;
    reset_unix: number;
    via: string;
    observed_at: string;
  } | null;
}

function routeLabel(route: GitHubAccessSnapshot["current_route"]) {
  switch (route) {
    case "proxy":
      return "手动代理服务器";
    case "manual":
      return "手动加速镜像源";
    case "mihomo":
      return "Mihomo 出口";
    default:
      return "GitHub 官方直连";
  }
}

const inputClass =
  "gary-field w-full px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground";

function viaLabel(via: string) {
  switch (via) {
    case "token":
      return "Token 认证";
    case "github":
      return "GitHub 官方连接";
    default:
      return via || "代理/直连";
  }
}

export function GitHubAcceleratorCard() {
  const [snapshot, setSnapshot] = useState<GitHubAccessSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");

  const load = useCallback(async (probe = false) => {
    setBusy(true);
    try {
      const payload = await api(
        probe ? "/api/v1/github/accelerators/probe" : "/api/v1/github/accelerators",
        probe ? { method: "POST" } : undefined,
      );
      if (payload?.success) {
        setSnapshot(apiData<GitHubAccessSnapshot>(payload));
        setLoadError("");
      } else {
        setLoadError(payload?.error || "加载 GitHub Token 状态失败");
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const payload = await api("/api/v1/github/accelerators", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (payload?.success) {
        setSnapshot(apiData<GitHubAccessSnapshot>(payload));
        setLoadError("");
        return true;
      }
      setLoadError(payload?.error || "保存失败");
      return false;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const rateLimit = snapshot?.rate_limit || null;

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        代理服务器和加速镜像源只使用你在“初始化配置”中手动填写的地址；MSF 不预置、不自动探测，也不会自动切换镜像。
      </p>

      {loadError ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {loadError}
        </p>
      ) : null}

      <div className="rounded-md border border-border/60 bg-card/55 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-foreground">手动加速源检测</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              当前下载线路：{snapshot ? routeLabel(snapshot.current_route) : "正在读取"}
            </p>
          </div>
          <button
            type="button"
            disabled={busy || !snapshot?.manual_prefix}
            onClick={() => void load(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            检测手动加速源
          </button>
        </div>
        <p className="mt-2 break-all font-mono text-[11px] text-foreground">
          {snapshot?.manual_prefix || "尚未填写加速前缀"}
        </p>
        {snapshot?.probe ? (
          <p className={`mt-2 text-[11px] ${snapshot.probe.ok ? "text-emerald-600" : "text-destructive"}`}>
            {snapshot.probe.ok
              ? `连接正常 · ${snapshot.probe.latency_ms}ms · HTTP ${snapshot.probe.status || "-"}`
              : `检测失败：${snapshot.probe.error || "未返回有效内容"}`}
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            仅在点击按钮时检测上方这一个手填地址；结果不改变下载线路。
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">Personal Access Token（可选）</span>
        {busy && !snapshot ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在读取
          </span>
        ) : snapshot?.github_token_masked ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            已配置 {snapshot.github_token_masked}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">未配置，匿名限流 60 次/小时/IP</span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <input
          type="password"
          value={tokenDraft}
          onChange={(event) => setTokenDraft(event.target.value)}
          placeholder="输入 GitHub Personal Access Token"
          autoComplete="off"
          className={`${inputClass} h-10`}
        />
        <button
          type="button"
          disabled={busy || tokenDraft.trim().length === 0}
          onClick={async () => {
            if (await save({ github_token: tokenDraft.trim() })) setTokenDraft("");
          }}
          className="h-10 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          保存 Token
        </button>
        {snapshot?.github_token_masked ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save({ reset_token: true })}
            className="h-10 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          >
            清除
          </button>
        ) : null}
      </div>

      {rateLimit ? (
        <p className="text-[11px] text-muted-foreground">
          最近一次 GitHub API 配额（{viaLabel(rateLimit.via)}）：剩余 {rateLimit.remaining}/{rateLimit.limit}
          {rateLimit.reset_unix > 0
            ? `，${new Date(rateLimit.reset_unix * 1000).toLocaleTimeString()} 重置`
            : ""}
        </p>
      ) : null}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Token 使用本机密钥加密保存，只发送给 GitHub 官方 API，不会发送到你填写的加速镜像。公开仓库只读访问无需勾选额外权限。
      </p>
    </div>
  );
}
