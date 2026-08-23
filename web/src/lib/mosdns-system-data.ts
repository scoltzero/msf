// Re-extracted data from live MosDNS System page at 192.168.10.3:7777/mosdns/system

export interface UpstreamServer {
  id: string;
  name: string;
  note?: string;
  protocol: string;
  address: string;
  enabled: boolean;
  accountId?: string;
  accessKeyId?: string;
  accessKeySecretSet?: boolean;
  ecsClientMask?: number;
}

export interface UpstreamGroup {
  id: string;
  name: string;
  subtitle: string;
  defaultExpanded: boolean;
  servers: UpstreamServer[];
}

export interface GlobalSettings {
  socks5: string;
  ecsIp: string;
  logCapacity: number;
}

export type RunMode = "compatible" | "safe";

export interface FilterSettings {
  adBlock: boolean;
  requestBlock: boolean;
  typeBlock: boolean;
  ipv6Block: boolean;
}

export interface ResolutionSettings {
  ipv4First: boolean;
  ipv6First: boolean;
}

export interface CacheStats {
  realIp: number;
  fakeIp: number;
  noV4: number;
  noV6: number;
  totalDomains: number;
}

export interface CacheStrategy {
  expiredCache1: boolean;
  expiredCache2: boolean;
}

export interface ScheduledTask {
  enabled: boolean;
  firstRunTime: string;
  intervalMinutes: number;
  refreshDays: number;
}

export interface TaskStatus {
  currentStatus: string;
  lastRunTime: string;
  lastRunRelative: string;
  lastRunDuration: string;
  records?: string[];
}

export interface CacheSystemData {
  stats: CacheStats;
  strategy: CacheStrategy;
  scheduledTask: ScheduledTask;
  taskStatus: TaskStatus;
}

export interface CacheDomainRow {
  id: string;
  domain: string;
  date?: string;
  source?: string;
}

/* ─── Global Settings ─── */
export const defaultGlobalSettings: GlobalSettings = {
  socks5: "127.0.0.1:7891",
  ecsIp: "2408:8214:213::1",
  logCapacity: 100000,
};

/* ─── Run Mode ─── */
export const defaultRunMode: RunMode = "compatible";

/* ─── Upstream DNS Groups ─── */
export const upstreamGroups: UpstreamGroup[] = [
  {
    id: "domestic",
    name: "国内",
    subtitle: "国内直连上游",
    defaultExpanded: true,
    servers: [
      { id: "d1", name: "阿里私享DOH", note: "账号: 234324234", protocol: "aliapi", address: "223.5.5.5", enabled: true },
      { id: "d2", name: "阿里UDP", protocol: "udp", address: "223.5.5.5", enabled: true },
      { id: "d3", name: "阿里TCP", protocol: "tcp", address: "tcp://223.5.5.5", enabled: true },
      { id: "d4", name: "阿里DOH", note: "拨号: 223.5.5.5", protocol: "https", address: "https://dns.alidns.com/dns-query", enabled: true },
      { id: "d5", name: "阿里DOT", protocol: "tls", address: "tls://223.5.5.5", enabled: true },
      { id: "d6", name: "运营商", protocol: "udp", address: "114.114.114.114", enabled: true },
      { id: "d7", name: "腾讯", protocol: "tcp", address: "tcp://119.29.29.29", enabled: false },
    ],
  },
  {
    id: "foreign",
    name: "国外",
    subtitle: "国外代理上游",
    defaultExpanded: false,
    servers: [
      { id: "f1", name: "Google DNS", protocol: "https", address: "https://dns.google/dns-query", enabled: true },
      { id: "f2", name: "Cloudflare", protocol: "https", address: "https://cloudflare-dns.com/dns-query", enabled: true },
    ],
  },
  {
    id: "foreign-ecs",
    name: "国外 ECS",
    subtitle: "国外 ECS 上游",
    defaultExpanded: false,
    servers: [
      { id: "e1", name: "Google ECS", protocol: "https", address: "https://dns.google/dns-query", enabled: true },
    ],
  },
  {
    id: "fakeip-foreign",
    name: "代理 FakeIP",
    subtitle: "foreign-fakeip",
    defaultExpanded: false,
    servers: [
      { id: "ff1", name: "nocnfake", protocol: "udp", address: "udp://127.0.0.1:6666", enabled: true },
    ],
  },
  {
    id: "fakeip-domestic",
    name: "国内 FakeIP",
    subtitle: "cn-fakeip",
    defaultExpanded: false,
    servers: [
      { id: "fd1", name: "cnfake", protocol: "udp", address: "udp://127.0.0.1:1053", enabled: false },
    ],
  },
];

/* ─── Filter Settings ─── */
export const defaultFilterSettings: FilterSettings = {
  adBlock: true,
  requestBlock: true,
  typeBlock: true,
  ipv6Block: false,
};

/* ─── Resolution Settings ─── */
export const defaultResolutionSettings: ResolutionSettings = {
  ipv4First: false,
  ipv6First: false,
};

/* ─── Cache System Data ─── */
export const defaultCacheData: CacheSystemData = {
  stats: {
    realIp: 100,
    fakeIp: 100,
    noV4: 21,
    noV6: 100,
    totalDomains: 13573,
  },
  strategy: {
    expiredCache1: true,
    expiredCache2: true,
  },
  scheduledTask: {
    enabled: true,
    firstRunTime: "2025/10/15 04:30",
    intervalMinutes: 10080,
    refreshDays: 30,
  },
  taskStatus: {
    currentStatus: "空闲",
    lastRunTime: "2026/05/27 04:30",
    lastRunRelative: "5 天前",
    lastRunDuration: "22 分39 秒",
  },
};
