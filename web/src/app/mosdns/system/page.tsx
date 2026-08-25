"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SystemHeader } from "@/components/mosdns/SystemHeader";
import { GlobalSettingsCard } from "@/components/mosdns/GlobalSettingsCard";
import { UpstreamDNSSection } from "@/components/mosdns/UpstreamDNSSection";
import { UpstreamServerDialog, type UpstreamServerFormValues } from "@/components/mosdns/UpstreamServerDialog";
import { RequestFilterSection } from "@/components/mosdns/RequestFilterSection";
import { ResolutionPolicySection } from "@/components/mosdns/ResolutionPolicySection";
import { CacheSystemSection } from "@/components/mosdns/CacheSystemSection";
import { useToaster, ToastStack } from "@/components/Toaster";
import { api, apiData, apiList } from "@/lib/api";
import {
  type GlobalSettings,
  type RunMode,
  type FilterSettings,
  type ResolutionSettings,
  type CacheSystemData,
  type CacheStats,
  type CacheDomainRow,
  type UpstreamServer,
  type UpstreamGroup,
  type ScheduledTask,
} from "@/lib/mosdns-system-data";

type RawRecord = Record<string, any>;
type EditableServer = UpstreamServer & { raw?: RawRecord };
type UpstreamDialogState =
  | { mode: "add"; groupId: string }
  | { mode: "edit"; groupId: string; serverId: string };

const defaultGlobalSettings: GlobalSettings = {
  socks5: "",
  ecsIp: "-",
  logCapacity: 100000,
};

const defaultFilterSettings: FilterSettings = {
  adBlock: false,
  requestBlock: false,
  typeBlock: false,
  ipv6Block: false,
};

const defaultResolutionSettings: ResolutionSettings = {
  ipv4First: false,
  ipv6First: false,
};

const defaultCacheData: CacheSystemData = {
  stats: {
    realIp: 0,
    fakeIp: 0,
    noV4: 0,
    noV6: 0,
    totalDomains: 0,
  },
  strategy: {
    expiredCache1: false,
    expiredCache2: false,
  },
  scheduledTask: {
    enabled: false,
    firstRunTime: "-",
    intervalMinutes: 43200,
    refreshDays: 30,
  },
  taskStatus: {
    currentStatus: "-",
    lastRunTime: "-",
    lastRunRelative: "-",
    lastRunDuration: "-",
    records: [],
  },
};

const SWITCH = {
  requestBlock: "switch1",
  typeBlock: "switch5",
  ipv6Block: "switch6",
  adBlock: "switch7",
  ipv4First: "switch8",
  ipv6First: "switch10",
  runMode: "switch3",
  expiredCache1: "switch4",
  expiredCache2: "switch13",
} as const;

const GROUP_META: Record<string, { name: string; subtitle: string; defaultExpanded: boolean; fake?: boolean }> = {
  domestic: { name: "国内", subtitle: "国内直连上游", defaultExpanded: true },
  foreign: { name: "国外", subtitle: "国外代理上游", defaultExpanded: false },
  foreignecs: { name: "国外 ECS", subtitle: "国外 ECS 上游", defaultExpanded: false },
  foreign_fakeip: { name: "代理 FakeIP", subtitle: "foreign-fakeip", defaultExpanded: true, fake: true },
};

const GROUP_ORDER = ["domestic", "foreign", "foreignecs", "foreign_fakeip"];

function asBool(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1" || value === "A";
  return Boolean(value);
}

function numberValue(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function sortUpstreamGroups(nextGroups: UpstreamGroup[]) {
  return [...nextGroups].sort((a, b) => {
    const aIndex = GROUP_ORDER.indexOf(a.id);
    const bIndex = GROUP_ORDER.indexOf(b.id);
    const aRank = aIndex === -1 ? GROUP_ORDER.length : aIndex;
    const bRank = bIndex === -1 ? GROUP_ORDER.length : bIndex;
    if (aRank !== bRank) return aRank - bRank;
    return a.id.localeCompare(b.id);
  });
}

function normalizeServerName(value: unknown) {
  return String(value || "").trim();
}

function cacheStatFromRecord(value: unknown): CacheStats | null {
  if (!value || typeof value !== "object") return null;
  const record = value as RawRecord;
  const stats = {
    realIp: numberValue(record.realIp ?? record.realip ?? record.real_ip ?? record.real),
    fakeIp: numberValue(record.fakeIp ?? record.fakeip ?? record.fake_ip ?? record.fake),
    noV4: numberValue(record.noV4 ?? record.nov4 ?? record.no_v4),
    noV6: numberValue(record.noV6 ?? record.nov6 ?? record.no_v6),
    totalDomains: numberValue(record.totalDomains ?? record.total_domains ?? record.total ?? record.entries),
  };
  const sum = stats.realIp + stats.fakeIp + stats.noV4 + stats.noV6;
  if (sum === 0) return null;
  if (stats.totalDomains === 0) stats.totalDomains = sum;
  return stats;
}

function cacheStatFromDomainPayload(...payloads: unknown[]): CacheStats | null {
  for (const payload of payloads) {
    const data = apiData<RawRecord>(payload as any, payload as RawRecord) || {};
    const domainBuckets = (data.domains || data.domain_lists || data.domainLists || {}) as RawRecord;
    const counts = {
      realIp: normalizeCacheDomainRows(domainBuckets.realIp || domainBuckets.realip || domainBuckets.real).length,
      fakeIp: normalizeCacheDomainRows(domainBuckets.fakeIp || domainBuckets.fakeip || domainBuckets.fake).length,
      noV4: normalizeCacheDomainRows(domainBuckets.noV4 || domainBuckets.nov4 || domainBuckets.no_v4).length,
      noV6: normalizeCacheDomainRows(domainBuckets.noV6 || domainBuckets.nov6 || domainBuckets.no_v6).length,
      totalDomains: 0,
    };
    const sum = counts.realIp + counts.fakeIp + counts.noV4 + counts.noV6;
    if (sum > 0) {
      counts.totalDomains = sum;
      return counts;
    }
  }
  return null;
}

function switchMap(...payloads: unknown[]) {
  const map: Record<string, boolean> = {};
  payloads.forEach((payload) => {
    apiList<RawRecord>(payload as any, ["data", "switches", "items"]).forEach((item) => {
      const key = String(item.key || "");
      if (key) map[key] = asBool(item.value ?? item.enable ?? item.enabled);
    });
  });
  return map;
}

function normalizeUpstreamGroups(payload: unknown): UpstreamGroup[] {
  const data = apiData<RawRecord>(payload as any, payload as RawRecord) || {};
  return sortUpstreamGroups(Object.entries(data).map(([key, value]) => {
    const meta = GROUP_META[key] || { name: key, subtitle: key, defaultExpanded: false };
    const servers = Array.isArray(value) ? value : [];
    return {
      id: key,
      name: meta.name,
      subtitle: meta.subtitle,
      defaultExpanded: meta.defaultExpanded,
      servers: servers.map((server, index) => {
        const raw = server && typeof server === "object" ? { ...(server as RawRecord) } : {};
        const address = String(raw.addr || raw.server_addr || raw.address || "");
        const name = normalizeServerName(raw.tag || raw.name || `上游 ${index + 1}`);
        if (GROUP_META[key]?.fake) raw.tag = name;
        const noteParts = [raw.note, raw.account_id ? `账户: ${raw.account_id}` : "", raw.socks5 ? `SOCKS5 ${raw.socks5}` : "", raw.dial_addr ? `拨号 ${raw.dial_addr}` : ""].filter(Boolean);
        return {
          id: `${key}:${index}:${name || address}`,
          name,
          note: noteParts.join(" · ") || undefined,
          protocol: String(raw.protocol || "udp"),
          address,
          enabled: asBool(raw.enabled ?? true),
          accountId: String(raw.account_id || ""),
          accessKeyId: String(raw.access_key_id || ""),
          accessKeySecretSet: asBool(raw.access_key_secret_set),
          ecsClientMask: numberValue(raw.ecs_client_mask ?? 32),
          raw,
        } satisfies EditableServer;
      }),
    };
  }));
}

function groupsToPayload(groups: UpstreamGroup[], socks5?: string) {
  const payload: Record<string, RawRecord[]> = {};
  sortUpstreamGroups(groups).forEach((group) => {
    payload[group.id] = group.servers.map((server) => {
      const editable = server as EditableServer;
      const raw = { ...(editable.raw || {}) };
      const addressKey = raw.server_addr !== undefined && raw.addr === undefined ? "server_addr" : "addr";
      raw.tag = normalizeServerName(server.name);
      raw.protocol = server.protocol;
      raw.enabled = server.enabled;
      raw[addressKey] = server.address;
      if (socks5 !== undefined && (raw.socks5 !== undefined || group.id === "foreign" || group.id === "foreignecs")) {
        raw.socks5 = socks5;
      }
      return raw;
    });
  });
  return payload;
}

function redactLocalUpstreamSecrets(groups: UpstreamGroup[]) {
  return groups.map((group) => ({
    ...group,
    servers: group.servers.map((server) => {
      const editable = server as EditableServer;
      if (!editable.raw?.access_key_secret) return server;
      const raw: RawRecord = { ...editable.raw, access_key_secret_set: true };
      delete raw.access_key_secret;
      return { ...server, accessKeySecretSet: true, raw } satisfies EditableServer;
    }),
  }));
}

function extractSocks5(groups: UpstreamGroup[]) {
  for (const group of groups) {
    for (const server of group.servers as EditableServer[]) {
      if (server.raw?.socks5) return String(server.raw.socks5);
    }
  }
  return "";
}

function normalizeCacheData(cachePayload: unknown, routingPayload: unknown, switches: Record<string, boolean>, cacheDetailPayload?: unknown): CacheSystemData {
  const cache = apiData<RawRecord>(cachePayload as any, cachePayload as RawRecord) || {};
  const routing = apiData<RawRecord>(routingPayload as any, routingPayload as RawRecord) || {};
  const scheduler = (routing.scheduler || {}) as RawRecord;
  const entries = Number(cache.entries || cache.total || 0);
  const directStats =
    cacheStatFromRecord(cache.stats) ||
    cacheStatFromRecord(cache.domain_stats) ||
    cacheStatFromRecord(cache.domainStats) ||
    cacheStatFromDomainPayload(cachePayload, cacheDetailPayload);
  const caches = Array.isArray(cache.caches) ? cache.caches : [];
  let classifiedCaches = 0;
  const counts = caches.reduce(
    (acc, item) => {
      const row = item as RawRecord;
      const name = String(row.name || row.type || row.tag || "").toLowerCase();
      const count = Number(row.entries || row.count || row.size || 0);
      if (count <= 0 || !name) return acc;
      classifiedCaches += 1;
      if (name.includes("fake")) acc.fakeIp += count;
      else if (name.includes("nov4") || name.includes("no_v4")) acc.noV4 += count;
      else if (name.includes("nov6") || name.includes("no_v6")) acc.noV6 += count;
      else acc.realIp += count;
      return acc;
    },
    { realIp: 0, fakeIp: 0, noV4: 0, noV6: 0 }
  );
  if (!directStats && classifiedCaches === 0) counts.realIp = entries;
  const stats = directStats || {
    realIp: counts.realIp,
    fakeIp: counts.fakeIp,
    noV4: counts.noV4,
    noV6: counts.noV6,
    totalDomains: entries || counts.realIp + counts.fakeIp + counts.noV4 + counts.noV6,
  };
  return {
    stats,
    strategy: {
      expiredCache1: switches[SWITCH.expiredCache1] === true,
      expiredCache2: switches[SWITCH.expiredCache2] === true,
    },
    scheduledTask: {
      enabled: asBool(scheduler.enabled),
      firstRunTime: String(scheduler.start_datetime || "-").replace("T", " "),
      intervalMinutes: Number(scheduler.interval_minutes || Number(scheduler.interval || 0) / 60 || 43200),
      refreshDays: Number(
        scheduler.date_range_days ||
          (scheduler.execution_settings as RawRecord | undefined)?.date_range_days ||
          (routing.execution_settings as RawRecord | undefined)?.date_range_days ||
          30
      ),
    },
    taskStatus: {
      currentStatus: routing.running ? "运行中" : String(routing.status || "空闲"),
      lastRunTime: String(routing.last_run_at || "-"),
      lastRunRelative: routing.progress !== undefined ? `进度 ${routing.progress}%` : "-",
      lastRunDuration: "-",
      records: normalizeTaskRecords(routing),
    },
  };
}

function normalizeTaskRecords(routing: RawRecord) {
  const records = apiList<unknown>(routing.records || routing.history || routing.logs, ["records", "history", "logs", "items"]);
  return records.slice(-8).map((record) => {
    if (typeof record === "string") return record;
    const row = record as RawRecord;
    return [row.time || row.created_at || row.updated_at, row.action || row.message || row.status].filter(Boolean).join(" ");
  }).filter(Boolean);
}

function normalizeDomainText(value: unknown) {
  return String(value || "")
    .replace(/^(domain|full|keyword):/i, "")
    .replace(/\s+\d+$/, "")
    .trim();
}

function normalizeCacheDomainRows(value: unknown): CacheDomainRow[] {
  const rows = Array.isArray(value) ? value : apiList<unknown>(value, ["data", "items", "entries", "domains"]);
  return rows
    .map((row, index) => {
      if (typeof row === "string") {
        const domain = normalizeDomainText(row);
        return domain ? { id: String(index + 1).padStart(10, "0"), domain } : null;
      }
      const item = row as RawRecord;
      const domain = normalizeDomainText(item.domain || item.query_name || item.name || item.value || item.pattern);
      if (!domain) return null;
      return {
        id: String(item.id || item.index || index + 1).padStart(10, "0"),
        domain,
        date: item.date ? String(item.date) : undefined,
        source: item.source || item.cache || item.tag ? String(item.source || item.cache || item.tag) : undefined,
      };
    })
    .filter(Boolean) as CacheDomainRow[];
}

function normalizeCacheDomains(payload: unknown): Partial<Record<"realIp" | "fakeIp" | "noV4" | "noV6", CacheDomainRow[]>> {
  const data = apiData<RawRecord>(payload as any, payload as RawRecord) || {};
  const domainBuckets = (data.domains || data.domain_lists || data.domainLists || {}) as RawRecord;
  const entries = apiList<RawRecord>(data.entries || data.items, ["entries", "items"]);
  const fallbackReal = entries.filter((item) => !String(item.domain_set || item.rule || "").toLowerCase().includes("fake"));
  const fallbackFake = entries.filter((item) => String(item.domain_set || item.rule || "").toLowerCase().includes("fake"));
  return {
    realIp: normalizeCacheDomainRows(domainBuckets.realIp || domainBuckets.realip || domainBuckets.real || fallbackReal),
    fakeIp: normalizeCacheDomainRows(domainBuckets.fakeIp || domainBuckets.fakeip || domainBuckets.fake || fallbackFake),
    noV4: normalizeCacheDomainRows(domainBuckets.noV4 || domainBuckets.nov4 || domainBuckets.no_v4),
    noV6: normalizeCacheDomainRows(domainBuckets.noV6 || domainBuckets.nov6 || domainBuckets.no_v6),
  };
}

export default function MosdnsSystemPage() {
  const { toasts, showToast } = useToaster();
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(defaultGlobalSettings);
  const [runMode, setRunMode] = useState<RunMode>("compatible");
  const [filterSettings, setFilterSettings] = useState<FilterSettings>(defaultFilterSettings);
  const [resolutionSettings, setResolutionSettings] = useState<ResolutionSettings>(defaultResolutionSettings);
  const [prioritySaving, setPrioritySaving] = useState(false);
  const [cacheActionSaving, setCacheActionSaving] = useState(false);
  const [cacheData, setCacheData] = useState<CacheSystemData>(defaultCacheData);
  const [cacheDomains, setCacheDomains] = useState<Partial<Record<"realIp" | "fakeIp" | "noV4" | "noV6", CacheDomainRow[]>>>({});
  const [taskEvents, setTaskEvents] = useState<string[]>([]);
  const [groups, setGroups] = useState<UpstreamGroup[]>([]);
  const [upstreamDialog, setUpstreamDialog] = useState<UpstreamDialogState | null>(null);
  const [saving, setSaving] = useState(false);

  const regularGroups = useMemo(() => sortUpstreamGroups(groups.filter((group) => !GROUP_META[group.id]?.fake)), [groups]);
  const fakeIPGroups = useMemo(() => sortUpstreamGroups(groups.filter((group) => GROUP_META[group.id]?.fake)), [groups]);
  const activeUpstreamDialog = useMemo(() => {
    if (!upstreamDialog) return null;
    const group = groups.find((item) => item.id === upstreamDialog.groupId);
    if (!group) return null;
    if (upstreamDialog.mode === "add") return { mode: upstreamDialog.mode, group, server: undefined };
    const server = group.servers.find((item) => item.id === upstreamDialog.serverId);
    if (!server) return null;
    return { mode: upstreamDialog.mode, group, server };
  }, [groups, upstreamDialog]);

  const loadSystem = useCallback(async () => {
    try {
      const [featurePayload, switchPayload, upstreamPayload, overridePayload, logCapacityPayload, cachePayload, routingPayload, cacheDetailPayload] = await Promise.all([
        api("/api/v1/mosdns/system/feature-switches"),
        api("/api/v1/mosdns/system/switches"),
        api("/api/v1/mosdns/system/upstream-overrides"),
        api("/api/v1/mosdns/system/overrides"),
        api("/api/v1/mosdns/system/log-capacity"),
        api("/api/v1/mosdns/system/cache"),
        api("/api/v1/mosdns/system/routing"),
        api("/api/v1/mosdns/cache/detailed"),
      ]);
      const switches = switchMap(featurePayload, switchPayload);
      const nextGroups = normalizeUpstreamGroups(upstreamPayload);
      const overrides = apiData<RawRecord>(overridePayload, overridePayload as RawRecord) || {};
      setGroups(nextGroups);
      setGlobalSettings({
        socks5: extractSocks5(nextGroups),
        ecsIp: String(overrides.ecs || "2408:8214:213::1"),
        logCapacity: Number(apiData<RawRecord>(logCapacityPayload, logCapacityPayload as RawRecord)?.capacity || 0),
      });
      setFilterSettings({
        adBlock: switches[SWITCH.adBlock] === true,
        requestBlock: switches[SWITCH.requestBlock] === true,
        typeBlock: switches[SWITCH.typeBlock] === true,
        ipv6Block: switches[SWITCH.ipv6Block] === true,
      });
      setResolutionSettings({
        ipv4First: switches[SWITCH.ipv4First] === true,
        ipv6First: switches[SWITCH.ipv6First] === true,
      });
      setRunMode(switches[SWITCH.runMode] === false ? "safe" : "compatible");
      setCacheData(normalizeCacheData(cachePayload, routingPayload, switches, cacheDetailPayload));
      setCacheDomains(normalizeCacheDomains(cacheDetailPayload));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "MosDNS 系统配置加载失败");
    }
  }, [showToast]);

  useEffect(() => {
    loadSystem();
  }, [loadSystem]);

  const saveLogCapacity = async () => {
    try {
      await api("/api/v1/mosdns/system/log-capacity", {
        method: "POST",
        body: JSON.stringify({ capacity: globalSettings.logCapacity }),
      });
      showToast("日志容量已保存");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "日志容量保存失败");
    }
  };

  const postSwitch = async (key: string, value: boolean) => {
    await api("/api/v1/mosdns/system/switches", {
      method: "POST",
      body: JSON.stringify({ key, value, enable: value }),
    });
  };

  const persistGroups = async (nextGroups: UpstreamGroup[], message = "上游 DNS 已保存") => {
    const payload = groupsToPayload(nextGroups, globalSettings.socks5);
    setGroups(sortUpstreamGroups(redactLocalUpstreamSecrets(nextGroups)));
    try {
      await api("/api/v1/mosdns/system/upstream-overrides", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast(message);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "上游 DNS 保存失败");
      await loadSystem();
    }
  };

  const handleToggleGroup = (groupId: string, enabled: boolean) => {
    const nextGroups = groups.map((group) => ({
      ...group,
      servers: group.id === groupId ? group.servers.map((server) => ({ ...server, enabled })) : group.servers,
    }));
    void persistGroups(nextGroups);
  };

  const handleToggleServer = (groupId: string, serverId: string) => {
    const nextGroups = groups.map((group) => ({
      ...group,
      servers: group.id === groupId ? group.servers.map((server) => (server.id === serverId ? { ...server, enabled: !server.enabled } : server)) : group.servers,
    }));
    void persistGroups(nextGroups);
  };

  const handleEditServer = (groupId: string, server: UpstreamServer) => {
    setUpstreamDialog({ mode: "edit", groupId, serverId: server.id });
  };

  const removeServer = (groupId: string, serverId: string) => {
    const nextGroups = groups.map((group) => ({
      ...group,
      servers: group.id === groupId ? group.servers.filter((server) => server.id !== serverId) : group.servers,
    }));
    void persistGroups(nextGroups, "上游 DNS 已删除");
  };

  const handleDeleteServer = (groupId: string, serverId: string) => {
    if (!window.confirm("确认删除这个上游 DNS？")) return;
    removeServer(groupId, serverId);
  };

  const handleAddServer = (groupId: string) => {
    setUpstreamDialog({ mode: "add", groupId });
  };

  const rawForServer = (groupId: string, server: UpstreamServer | undefined, values: UpstreamServerFormValues) => {
    const editable = server as EditableServer | undefined;
    const raw = { ...(editable?.raw || {}) };
    raw.tag = normalizeServerName(values.name);
    raw.protocol = values.protocol;
    raw.enabled = values.enabled;
    if (values.protocol === "aliapi") {
      delete raw.addr;
      raw.server_addr = values.address;
      raw.account_id = values.accountId;
      raw.access_key_id = values.accessKeyId;
      raw.access_key_secret = values.accessKeySecret;
      raw.access_key_secret_set = values.accessKeySecretSet || Boolean(values.accessKeySecret);
      raw.ecs_client_mask = values.ecsClientMask;
    } else {
      for (const key of ["account_id", "access_key_id", "access_key_secret", "access_key_secret_set", "server_addr", "ecs_client_mask"]) delete raw[key];
      raw.addr = values.address;
    }
    return raw;
  };

  const saveUpstreamDialog = (values: UpstreamServerFormValues) => {
    if (!upstreamDialog) return;
    const canonicalName = normalizeServerName(values.name);
    if (upstreamDialog.mode === "edit") {
      const nextGroups = groups.map((group) => ({
        ...group,
        servers:
          group.id === upstreamDialog.groupId
            ? group.servers.map((server) =>
                server.id === upstreamDialog.serverId
                  ? ({
                      ...server,
                      name: canonicalName,
                      protocol: values.protocol,
                      address: values.address,
                      enabled: values.enabled,
                      accountId: values.accountId,
                      accessKeyId: values.accessKeyId,
                      accessKeySecretSet: values.accessKeySecretSet || Boolean(values.accessKeySecret),
                      ecsClientMask: values.ecsClientMask,
                      raw: rawForServer(group.id, server, { ...values, name: canonicalName }),
                    } satisfies EditableServer)
                  : server
              )
            : group.servers,
      }));
      setUpstreamDialog(null);
      void persistGroups(nextGroups);
      return;
    }
    const nextGroups = groups.map((group) =>
      group.id === upstreamDialog.groupId
        ? {
            ...group,
            servers: [
              ...group.servers,
              {
                id: `${group.id}:${Date.now()}:${canonicalName}`,
                name: canonicalName,
                protocol: values.protocol,
                address: values.address,
                enabled: values.enabled,
                accountId: values.accountId,
                accessKeyId: values.accessKeyId,
                accessKeySecretSet: Boolean(values.accessKeySecret),
                ecsClientMask: values.ecsClientMask,
                raw: rawForServer(group.id, undefined, { ...values, name: canonicalName }),
              } satisfies EditableServer,
            ],
          }
        : group
    );
    setUpstreamDialog(null);
    void persistGroups(nextGroups, "上游 DNS 已添加");
  };

  const deleteUpstreamDialogServer = () => {
    if (!upstreamDialog || upstreamDialog.mode !== "edit") return;
    if (!window.confirm("确认删除这个上游 DNS？")) return;
    const { groupId, serverId } = upstreamDialog;
    setUpstreamDialog(null);
    removeServer(groupId, serverId);
  };

  const updateGlobalSettings = (patch: Partial<GlobalSettings>) => {
    setGlobalSettings((prev) => ({ ...prev, ...patch }));
  };

  const toggleFilter = async (key: keyof FilterSettings) => {
    const next = !filterSettings[key];
    setFilterSettings((prev) => ({ ...prev, [key]: next }));
    try {
      await postSwitch(SWITCH[key], next);
      showToast("过滤开关已保存");
    } catch (error) {
      setFilterSettings((prev) => ({ ...prev, [key]: !next }));
      showToast(error instanceof Error ? error.message : "过滤开关保存失败");
    }
  };

  const changeResolutionPriority = async (priority: "auto" | "ipv4" | "ipv6") => {
    if (prioritySaving) return;
    const previous = resolutionSettings;
    const next = { ipv4First: priority === "ipv4", ipv6First: priority === "ipv6" };
    setResolutionSettings(next);
    setPrioritySaving(true);
    try {
      await api("/api/v1/mosdns/system/priority", {
        method: "PUT",
        body: JSON.stringify({ priority }),
      });
      showToast("解析策略已保存");
    } catch (error) {
      setResolutionSettings(previous);
      showToast(error instanceof Error ? error.message : "解析策略保存失败");
    } finally {
      setPrioritySaving(false);
    }
  };

  const changeRunMode = async (mode: RunMode) => {
    setRunMode(mode);
    try {
      await postSwitch(SWITCH.runMode, mode === "compatible");
      showToast("运行模式已保存");
    } catch (error) {
      setRunMode((current) => (current === "compatible" ? "safe" : "compatible"));
      showToast(error instanceof Error ? error.message : "运行模式保存失败");
    }
  };

  const toggleCacheStrategy = async (key: "expiredCache1" | "expiredCache2") => {
    const next = !cacheData.strategy[key];
    setCacheData((prev) => ({ ...prev, strategy: { ...prev.strategy, [key]: next } }));
    try {
      await postSwitch(SWITCH[key], next);
      showToast("缓存策略已保存");
    } catch (error) {
      setCacheData((prev) => ({ ...prev, strategy: { ...prev.strategy, [key]: !next } }));
      showToast(error instanceof Error ? error.message : "缓存策略保存失败");
    }
  };

  const saveScheduler = async () => {
    const task = cacheData.scheduledTask;
    try {
      await api("/api/v1/mosdns/system/routing/scheduler", {
        method: "POST",
        body: JSON.stringify({
          enabled: task.enabled,
          start_datetime: task.firstRunTime === "-" ? "" : task.firstRunTime,
          interval_minutes: task.intervalMinutes,
          interval: task.intervalMinutes * 60,
          date_range_days: task.refreshDays,
          execution_settings: { date_range_days: task.refreshDays },
        }),
      });
      showToast("定时任务已保存");
      await loadSystem();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "定时任务保存失败");
    }
  };

  const runRoutingAction = async (path: "start" | "save" | "clear", message: string) => {
    try {
      await api(`/api/v1/mosdns/system/routing/${path}`, { method: "POST" });
      const record = `${new Date().toLocaleString("zh-CN", { hour12: false })} ${message}`;
      setTaskEvents((current) => [...current.slice(-7), record]);
      showToast(message);
      await loadSystem();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "操作失败");
    }
  };

  const clearDNSCache = async () => {
    if (cacheActionSaving) return;
    if (!window.confirm("确定清空全部 MosDNS DNS 缓存吗？\n\n不会删除规则、订阅、配置或 Mihomo Fake-IP 数据库。清空后首次 DNS 查询可能稍慢。")) return;
    setCacheActionSaving(true);
    try {
      const payload = await api<any>("/api/v1/mosdns/cache/clear", { method: "POST" });
      if (payload?.success === false) {
        const failed = Object.keys(payload?.data?.failed || {});
        throw new Error(failed.length ? `部分缓存清理失败：${failed.join("、")}` : String(payload?.message || "DNS 缓存清理失败"));
      }
      showToast(payload?.message || "DNS 缓存已清空");
      await loadSystem();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "DNS 缓存清理失败");
    } finally {
      setCacheActionSaving(false);
    }
  };

  const clearGeneratedRules = async () => {
    if (cacheActionSaving) return;
    if (!window.confirm("确定清空自动生成的分流规则吗？\n\n将清空 FakeIP、RealIP 和高频域名生成文件，不会清理 DNS 缓存。")) return;
    setCacheActionSaving(true);
    try {
      await runRoutingAction("clear", "生成规则已清空");
    } finally {
      setCacheActionSaving(false);
    }
  };

  const saveAndRestart = async () => {
    setSaving(true);
    const task = cacheData.scheduledTask;
    try {
      await Promise.all([
        api("/api/v1/mosdns/system/log-capacity", { method: "POST", body: JSON.stringify({ capacity: globalSettings.logCapacity }) }),
        api("/api/v1/mosdns/system/upstream-overrides", { method: "POST", body: JSON.stringify(groupsToPayload(groups, globalSettings.socks5)) }),
        api("/api/v1/mosdns/system/overrides", { method: "POST", body: JSON.stringify({ socks5: globalSettings.socks5, ecs: globalSettings.ecsIp }) }),
        api("/api/v1/mosdns/system/routing/scheduler", {
          method: "POST",
          body: JSON.stringify({
            enabled: task.enabled,
            start_datetime: task.firstRunTime === "-" ? "" : task.firstRunTime,
            interval_minutes: task.intervalMinutes,
            interval: task.intervalMinutes * 60,
            date_range_days: task.refreshDays,
            execution_settings: { date_range_days: task.refreshDays },
          }),
        }),
      ]);
      await api("/api/v1/services/mosdns/restart?wait=1&timeout=5", { method: "POST" });
      showToast("配置已保存，MosDNS 已重启");
      await loadSystem();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存并重启失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-4 pb-4">
        <SystemHeader onSave={saveAndRestart} saving={saving} />

        <GlobalSettingsCard
          settings={globalSettings}
          onChangeSocks5={(value) => updateGlobalSettings({ socks5: value })}
          onChangeEcsIp={(value) => updateGlobalSettings({ ecsIp: value })}
          onChangeLogCapacity={(value) => updateGlobalSettings({ logCapacity: value })}
          onSaveLogCapacity={saveLogCapacity}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RequestFilterSection
            filterSettings={filterSettings}
            onToggleAdBlock={() => void toggleFilter("adBlock")}
            onToggleRequestBlock={() => void toggleFilter("requestBlock")}
            onToggleTypeBlock={() => void toggleFilter("typeBlock")}
            onToggleIpv6Block={() => void toggleFilter("ipv6Block")}
          />
          <ResolutionPolicySection
            runMode={runMode}
            onChangeRunMode={(mode) => void changeRunMode(mode)}
            resolutionSettings={resolutionSettings}
            prioritySaving={prioritySaving}
            onChangePriority={(priority) => void changeResolutionPriority(priority)}
          />
        </div>

        <div className="grid items-start gap-4 2xl:grid-cols-2">
          <UpstreamDNSSection
            regularGroups={regularGroups}
            fakeIPGroups={fakeIPGroups}
            onToggleGroup={handleToggleGroup}
            onToggleServer={handleToggleServer}
            onEditServer={handleEditServer}
            onDeleteServer={handleDeleteServer}
            onAddServer={handleAddServer}
          />

          <CacheSystemSection
            data={{
              ...cacheData,
              taskStatus: {
                ...cacheData.taskStatus,
                records: [...(cacheData.taskStatus.records || []), ...taskEvents],
              },
            }}
            cacheDomains={cacheDomains}
            onToggleCache1={() => void toggleCacheStrategy("expiredCache1")}
            onToggleCache2={() => void toggleCacheStrategy("expiredCache2")}
            onChangeTask={(task: ScheduledTask) => setCacheData((prev) => ({ ...prev, scheduledTask: task }))}
            onSaveTask={saveScheduler}
            onHotReload={() => void runRoutingAction("start", "热更新已启动")}
            onSaveRules={() => void runRoutingAction("save", "规则已保存")}
            onClearDNSCache={() => void clearDNSCache()}
            onClearGeneratedRules={() => void clearGeneratedRules()}
            actionDisabled={cacheActionSaving}
          />
        </div>
      </div>
      {activeUpstreamDialog && (
        <UpstreamServerDialog
          mode={activeUpstreamDialog.mode}
          group={activeUpstreamDialog.group}
          server={activeUpstreamDialog.server}
          onClose={() => setUpstreamDialog(null)}
          onSave={saveUpstreamDialog}
          onDelete={activeUpstreamDialog.mode === "edit" ? deleteUpstreamDialogServer : undefined}
        />
      )}
      <ToastStack toasts={toasts} />
    </AppShell>
  );
}
