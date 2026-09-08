"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Gamepad2, Loader2 } from "lucide-react";
import { api, apiData } from "@/lib/api";
import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { SolidPlate } from "@/components/liquid-glass/SolidPlate";

const inputClass =
  "gary-field w-full px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground";

// 游戏 UDP 直连端口（nft game_udp_bypass）：国服游戏的 UDP 流量在内核层
// 绕过代理直连，规避 mihomo 隧道 UDP 会话 60 秒空闲超时导致的周期性断线。
// 默认 22101,22102 为米哈游网关端口（原神/星铁/绝区零共用）。
export function GameUdpBypassCard({ showToast }: { showToast: (message: string) => void }) {
  const [ports, setPorts] = useState("22101, 22102");
  const [defaultPorts, setDefaultPorts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tunOnly, setTunOnly] = useState(false);
  const [chinaEnabled, setChinaEnabled] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api("/api/v1/settings"),
      api("/api/v1/setup/config"),
    ]).then(([settingsResult, configResult]) => {
      if (settingsResult.status === "fulfilled") {
        const data = apiData<Record<string, string>>(settingsResult.value, {});
        const raw = String(data["network.game_udp_bypass_ports"] || "").trim();
        if (raw) {
          setPorts(raw);
          setDefaultPorts(false);
        }
        setChinaEnabled(String(data["network.china_udp_bypass"] ?? "") !== "false");
      }
      if (configResult.status === "fulfilled") {
        const config = apiData<Record<string, any>>(configResult.value, {});
        if (String(config.linux_proxy_mode || "") === "tun") setTunOnly(true);
      }
    });
  }, []);

  const toggleChina = useCallback(async (next: boolean) => {
    setChinaEnabled(next);
    setSaving(true);
    try {
      const payload = await api<any>("/api/v1/settings", {
        method: "PUT",
        body: JSON.stringify({ "network.china_udp_bypass": next ? "true" : "false" }),
      });
      if (payload?.nft_refresh_error) {
        showToast(`开关已保存，但防火墙热更新失败（${payload.nft_refresh_error}）；重启服务后生效`);
      } else {
        showToast(next ? "国内 UDP 直连已开启（即时生效）" : "国内 UDP 直连已关闭（即时生效）");
      }
    } catch (error) {
      setChinaEnabled(!next);
      showToast(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [showToast]);

  const save = useCallback(async () => {
    const normalized = ports
      .split(/[,，;\s]+/)
      .map((item) => Number(item.trim()))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535);
    if (normalized.length === 0) {
      showToast("请至少填写一个有效端口（1-65535）");
      return;
    }
    setSaving(true);
    try {
      const payload = await api<any>("/api/v1/settings", {
        method: "PUT",
        body: JSON.stringify({ "network.game_udp_bypass_ports": normalized.join(",") }),
      });
      const joined = normalized.join(", ");
      setPorts(joined);
      setDefaultPorts(false);
      if (payload?.nft_refresh_error) {
        showToast(`端口已保存，但防火墙热更新失败（${payload.nft_refresh_error}）；重启服务后生效`);
      } else {
        showToast(payload?.nft_refreshed ? "游戏 UDP 直连端口已保存并即时生效" : "游戏 UDP 直连端口已保存");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [ports, showToast]);

  return (
    <GlassSurface material="thick" className="rounded-2xl">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <SolidPlate tone="subtle" className="flex h-8 w-8 items-center justify-center rounded-lg text-primary">
            <Gamepad2 className="h-4 w-4" />
          </SolidPlate>
          <div>
            <h3 className="text-base font-semibold tracking-tight">游戏 UDP 直连端口</h3>
            <p className="text-xs text-muted-foreground">国服游戏流量内核层绕过代理，防周期性断线</p>
          </div>
        </div>

        <div className="rounded-xl border border-border/40 bg-background/40 p-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">国内 UDP 直连（推荐开启）</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                目的地为国内 IP 的 UDP 流量在内核层直接放行、不经过代理隧道——所有国服游戏（原神/星铁/王者等）
                零配置免受代理隧道的 60 秒会话超时断线影响。仅当某国内 IP 需要 UDP 走代理（罕见，如国内中转）时才关闭。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={chinaEnabled}
              aria-label={chinaEnabled ? "关闭国内 UDP 直连" : "开启国内 UDP 直连"}
              disabled={saving}
              onClick={() => toggleChina(!chinaEnabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0 transition-colors disabled:opacity-60 ${chinaEnabled ? "bg-emerald-500" : "bg-muted"}`}
            >
              <span className={`pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${chinaEnabled ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border/40 bg-background/40 p-3">
          <label className="text-sm font-semibold text-foreground">游戏 UDP 直连端口（补充覆盖）</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              value={ports}
              onChange={(event) => setPorts(event.target.value)}
              placeholder="22101, 22102"
              spellCheck={false}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => save()}
              disabled={saving}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              保存
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            国内 UDP 直连已覆盖国服游戏；此列表用于海外目标但需要直连的场景（如自建语音服）。
            默认 <span className="font-mono">22101, 22102</span>（米哈游网关）。保存后防火墙即时生效。
            {defaultPorts && " 当前为默认值。"}
          </p>
          {tunOnly && (
            <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              当前为 TUN 代理模式，此设置不生效（仅 nftables 模式下生效）。
            </p>
          )}
        </div>
      </div>
    </GlassSurface>
  );
}
