export interface Rule {
  type: string;
  mode: string;
  content: string;
}

export interface RuleCategory {
  id: string;
  label: string;
  count: number;
  rules: Rule[];
}

const d = (content: string, mode = "domain"): Rule => ({ type: "whitelist", mode, content });

export const ruleCategories: RuleCategory[] = [
  {
    id: "whitelist",
    label: "直连",
    count: 8,
    rules: [
      d("lan-gateway.example.invalid", "full"),
      d("nas.example.invalid"),
      d("printer.example.invalid"),
      d("media.example.invalid"),
      d("updates.example.invalid"),
      d("auth.example.invalid", "full"),
      d("cdn.example.invalid"),
      d("ipv6-test.example.invalid", "full"),
    ],
  },
  {
    id: "blocklist",
    label: "拦截",
    count: 6,
    rules: [
      "ads.example.invalid",
      "telemetry.example.invalid",
      "tracker.example.invalid",
      "beacon.example.invalid",
      "metrics.example.invalid",
      "blocked-service.example.invalid",
    ].map((content) => ({ type: "blocklist", mode: "full", content })),
  },
  {
    id: "greylist",
    label: "代理",
    count: 6,
    rules: [
      { type: "greylist", mode: "full", content: "remote-app.example.invalid" },
      { type: "greylist", mode: "full", content: "sync.example.invalid" },
      { type: "greylist", mode: "full", content: "market-data.example.invalid" },
      { type: "greylist", mode: "domain", content: "search.example.invalid" },
      { type: "greylist", mode: "domain", content: "video.example.invalid" },
      { type: "greylist", mode: "domain", content: "archive.example.invalid" },
    ],
  },
  {
    id: "ddnslist",
    label: "DDNS域名",
    count: 4,
    rules: [
      "home.example.invalid",
      "files.example.invalid",
      "router.example.invalid",
      "vpn.example.invalid",
    ].map((content) => ({ type: "ddnslist", mode: "默认", content })),
  },
  {
    id: "direct_ip",
    label: "直连IP",
    count: 1,
    rules: [{ type: "direct_ip", mode: "默认", content: "198.51.100.0/24" }],
  },
  {
    id: "rewrite",
    label: "重定向",
    count: 2,
    rules: [
      { type: "rewrite", mode: "full", content: "edge-a.example.invalid → 198.51.100.10" },
      { type: "rewrite", mode: "full", content: "edge-b.example.invalid → 203.0.113.20" },
    ],
  },
];

export interface SubscriptionRule {
  name: string;
  url: string;
  ruleCount: string;
  updatedAt: string;
  enabled: boolean;
}

export const adblockLists: SubscriptionRule[] = [
  { name: "httpdns", url: "https://example.invalid/rules/httpdns.txt", ruleCount: "64", updatedAt: "2025/12/19 16:33:45", enabled: true },
  { name: "pcdn1", url: "https://example.invalid/rules/pcdn-primary.txt", ruleCount: "20", updatedAt: "2025/12/19 16:33:45", enabled: true },
  { name: "pcdn2", url: "https://example.invalid/rules/pcdn-secondary.txt", ruleCount: "33", updatedAt: "2025/12/19 16:33:45", enabled: true },
];

export interface RoutingRule extends SubscriptionRule {
  typeLabel: string;
  typeKey: string;
  color: string;
}

export const routingTypes = [
  { key: "all", label: "全部" },
  { key: "geositecn", label: "中国域名 (geositecn)" },
  { key: "geositenocn", label: "非中国域名 (geositenocn)" },
  { key: "geoipcn", label: "中国IP (geoipcn)" },
  { key: "!cn@cn", label: "国内加速域名 (!cn@cn)" },
  { key: "cn@!cn", label: "国外专属域名 (cn@!cn)" },
];

export const routingLists: RoutingRule[] = [
  { name: "geosite_cn", typeLabel: "中国域名 (geositecn)", typeKey: "geositecn", color: "blue", url: "https://example.invalid/rules/geosite-cn.srs", ruleCount: "117,508", updatedAt: "2025/12/19 16:33:02", enabled: true },
  { name: "geosite_no_cn", typeLabel: "非中国域名 (geositenocn)", typeKey: "geositenocn", color: "purple", url: "https://example.invalid/rules/geosite-geolocation-not-cn.srs", ruleCount: "26,329", updatedAt: "2025/12/19 16:33:09", enabled: true },
  { name: "geoip_cn", typeLabel: "中国IP (geoipcn)", typeKey: "geoipcn", color: "green", url: "https://example.invalid/rules/geoip-cn.srs", ruleCount: "19,543", updatedAt: "2025/12/19 16:32:54", enabled: true },
  { name: "cuscn", typeLabel: "国内加速域名 (!cn@cn)", typeKey: "!cn@cn", color: "orange", url: "https://example.invalid/rules/geosite-custom-cn.srs", ruleCount: "1,089", updatedAt: "2025/12/19 16:32:42", enabled: true },
  { name: "cusnocn", typeLabel: "国外专属域名 (cn@!cn)", typeKey: "cn@!cn", color: "pink", url: "https://example.invalid/rules/geosite-custom-not-cn.srs", ruleCount: "262", updatedAt: "2025/12/19 16:32:48", enabled: true },
  { name: "tiktok", typeLabel: "国外专属域名 (cn@!cn)", typeKey: "cn@!cn", color: "pink", url: "https://example.invalid/rules/geosite-video.srs", ruleCount: "30", updatedAt: "2025/12/19 16:33:29", enabled: true },
];
