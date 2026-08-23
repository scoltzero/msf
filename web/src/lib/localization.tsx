import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import legacyTranslations from "@/lib/legacy-translation-map.json";

export type AppLanguage = "zh-CN" | "en-US";

export const LANGUAGE_STORAGE_KEY = "msf-language";

const manualTranslations: Record<string, string> = {
  "明亮": "Light",
  "暗黑": "Dark",
  "跟随系统": "System",
  "展开侧边栏": "Expand sidebar",
  "折叠侧边栏": "Collapse sidebar",
  "收起": "Collapse",
  "展开": "Expand",
  "语言": "Language",
  "打开用户菜单": "Open user menu",
  "管理员": "Administrator",
  "用户": "User",
  "个人信息": "Profile",
  "系统设定": "System settings",
  "帮助文档": "Documentation",
  "退出登录": "Sign out",
  "跳到主内容": "Skip to main content",
  "规则管理": "Rules",
  "客户端设置": "Client settings",
  "系统功能": "System",
  "配置管理": "Configuration",
  "实时日志": "Live logs",
  "日志查看": "Logs",
  "用户管理": "Users",
  "系统诊断": "Diagnostics",
  "系统设置": "Settings",
  "概述": "Overview",
  "概览": "Overview",
  "代理节点": "Proxies",
  "连接管理": "Connections",
  "DNS 日志": "DNS log",
  "个性化名单": "Personal lists",
  "广告拦截": "Ad blocking",
  "在线分流": "Online routing",
  "直连": "Direct",
  "拦截": "Block",
  "代理": "Proxy",
  "DDNS域名": "DDNS domains",
  "直连IP": "Direct IP",
  "重定向": "Rewrite",
  "添加规则": "Add source",
  "检查更新": "Update all",
  "全部更新": "Update all",
  "广告拦截规则": "Ad-blocking sources",
  "在线分流规则": "Online routing sources",
  "启用": "Enabled",
  "类型": "Type",
  "名称": "Name",
  "清单网址": "Source URL",
  "规则数": "Rules",
  "上次更新": "Last updated",
  "操作": "Actions",
  "全部": "All",
  "中国域名 (geositecn)": "China domains (geositecn)",
  "非中国域名 (geositenocn)": "Non-China domains (geositenocn)",
  "中国IP (geoipcn)": "China IPs (geoipcn)",
  "国内加速域名 (!cn@cn)": "China-accelerated domains (!cn@cn)",
  "国外专属域名 (cn@!cn)": "Overseas-only domains (cn@!cn)",
  "注意:": "Caution:",
  "请勿随意删除或禁用系统默认的分流规则!": "Do not delete or disable the system routing sources unless you understand the impact.",
  "暂无广告拦截规则源": "No ad-blocking sources",
  "暂无在线分流规则源": "No online routing sources",
  "规则源加载失败": "Failed to load rule sources",
  "规则源已添加": "Rule source added",
  "规则源添加失败": "Failed to add rule source",
  "规则源已保存": "Rule source saved",
  "规则源保存失败": "Failed to save rule source",
  "规则源状态已保存": "Rule source status saved",
  "规则源状态保存失败": "Failed to save rule source status",
  "规则源已更新": "Rule source updated",
  "规则源更新完成": "Rule sources updated",
  "规则源更新失败": "Failed to update rule sources",
  "确认删除这个规则源？": "Delete this rule source?",
  "规则源已删除": "Rule source deleted",
  "规则源删除失败": "Failed to delete rule source",
  "MosDNS 域名和 IP 规则 · 保存后自动热更新": "MosDNS domain and IP rules · Changes are applied live after saving",
  "条规则": "rule sources",
  "外观设置已保存": "Appearance settings saved",
  "语言 / Language": "Language",
  "简体中文": "Simplified Chinese",
  "关闭": "Off",
  "白名单": "Allowlist",
  "黑名单": "Blocklist",
  "加载中": "Loading",
  "已同步": "Synced",
  "需要扫描": "Scan required",
  "上次扫描": "Last scan",
  "拖拽客户端到右侧名单区域，或点击\"添加\"按钮": "Drag a client to the list on the right, or use the add button.",
  "新增客户端": "New client",
  "多选": "Select multiple",
  "加入当前名单": "Add to current list",
  "重新扫描": "Rescan",
  "清空并扫描": "Clear and scan",
  "客户端列表": "Clients",
  "在线优先 · IP 正序": "Online first · IP ascending",
  "代理策略已关闭": "Proxy policy is off",
  "当前所有客户端均可使用代理。如需限制特定客户端，请切换到白名单或黑名单模式。": "All clients can currently use the proxy. Switch to allowlist or blocklist mode to restrict access.",
  "暂无客户端": "No clients",
  "正在加载客户端...": "Loading clients...",
  "暂无白名单客户端": "No allowlisted clients",
  "暂无黑名单客户端": "No blocklisted clients",
  "白名单中的客户端可使用代理": "Allowlisted clients can use the proxy",
  "黑名单中的客户端不可使用代理": "Blocklisted clients cannot use the proxy",
  "未记录": "Not recorded",
  "刚刚": "Just now",
  "数据目录": "Data directory",
  "硬盘使用率": "Disk usage",
  "固定 100%": "Fixed 100%",
  "主机实时速率": "Host throughput",
  "实时": "Live",
  "CPU 使用率": "CPU usage",
  "内存使用率": "Memory usage",
  "MosDNS 服务": "MosDNS service",
  "Mihomo 服务": "Mihomo service",
  "1 分钟": "1 minute",
  "指定客户端直连": "Direct access for selected clients",
  "缓存统计": "Cache statistics",
  "缓存命中率": "Cache hit rate",
  "GOROUTINE 数量": "Goroutines",
  "保存并重启": "Save and restart",
  "设置": "Settings",
  "账户 ID": "Account ID",
  "已设置，留空则保持不变": "Already set; leave blank to keep it unchanged",
  "请输入 Access Key Secret": "Enter the Access Key Secret",
  "范围 0–128，通常使用 32": "Range 0–128; 32 is typical",
  "请完整填写账户 ID、Access Key、服务器地址和有效的 ECS Mask": "Complete the Account ID, access keys, server address, and a valid ECS mask",
  "运营商": "Carrier",
  "广告屏蔽": "Ad blocking",
  "启用 AdGuard 在线规则": "Enable AdGuard online rules",
  "请求屏蔽": "Request blocking",
  "屏蔽无解析结果请求": "Block requests without an answer",
  "类型屏蔽": "Type blocking",
  "屏蔽 SOA/PTR/HTTPS 请求": "Block SOA/PTR/HTTPS requests",
  "IPV6 屏蔽": "IPv6 blocking",
  "阻止 AAAA 请求类型": "Block AAAA requests",
  "🌐 兼容模式": "🌐 Compatibility mode",
  "🛡️ 安全模式": "🛡️ Safe mode",
  "兼容/安全模式切换": "Compatibility / safe mode",
  "延迟": "Latency",
  "重新测试": "Retest",
  "国内与国际出口": "Domestic and international egress",
  "未获取": "Unavailable",
  "全球连接": "Global connections",
  "星空": "Globe",
  "扁平": "Flat",
  "本机 IP": "Local IP",
  "连接线路": "Connection lines",
  "正在检查本地城市数据库…": "Checking the local city database…",
  "连接拓扑": "Connection topology",
  "订阅流量统计": "Subscription traffic",
  "已用 / 总量与剩余额度": "Used / total and remaining quota",
  "剩余": "Remaining",
  "连接统计": "Connection statistics",
  "条连接": "connections",
  "规则": "Rules",
  "自动刷新": "Auto refresh",
  "开": "On",
  "全部收起": "Collapse all",
  "全部测速": "Test all",
  "自定义排序": "Custom order",
  "分组": "Grouped",
  "全局节点": "Global nodes",
  "正则": "Regex",
  "配置顺序": "Config order",
  "名称升序": "Name ascending",
  "名称降序": "Name descending",
  "延迟升序": "Latency ascending",
  "延迟降序": "Latency descending",
  "配置编辑": "Edit configuration",
  "按 Controller 原始顺序": "Controller order",
  "可切换运行状态": "Runtime status can be toggled",
  "禁用后断开精确匹配连接": "Close exact matches when disabled",
  "最后命中：": "Last hit:",
  "最后未命中：": "Last miss:",
  "活跃 ·": "Active ·",
  "已关闭": "Closed",
  "上传总量": "Total upload",
  "下载速度": "Download speed",
  "活跃 (": "Active (",
  "已关闭 (": "Closed (",
  "表格": "Table",
  "卡片": "Cards",
  "目标": "Target",
  "主机 / 入站": "Host / inbound",
  "下载量": "Downloaded",
  "上传量": "Uploaded",
  "未设置": "Not set",
  "保存": "Save",
  "下载报告": "Download report",
  "警告": "Warnings",
  "错误": "Errors",
  "配置目录存在且可访问": "Configuration directory exists and is accessible",
  "配置文件": "Configuration files",
  "配置文件有效": "Configuration files are valid",
  "依赖项": "Dependencies",
  "依赖检查通过 6/6": "Dependency checks passed 6/6",
  "端口占用": "Port usage",
  "已检查 14 个端口": "Checked 14 ports",
  "磁盘空间": "Disk space",
  "磁盘空间充足": "Sufficient disk space",
  "文件权限": "File permissions",
  "具有必要的读写权限": "Required read/write permissions are available",
  "个端口": "ports",
  "正常": "Healthy",
  "期望:": "Expected:",
  "DNS 服务入口": "DNS service entry",
  "国外转发": "Overseas forwarding",
  "留空时自动使用": "Leave blank to use",
  "，也可以自定义相对路径。": ", or enter a custom relative path.",
};

const translations: Record<string, string> = {
  ...(legacyTranslations as Record<string, string>),
  ...manualTranslations,
};

const ignoredSelector = [
  "script",
  "style",
  "code",
  "pre",
  "textarea",
  ".cm-editor",
  "[contenteditable='true']",
  "[data-no-translate]",
].join(",");

function normalizeLanguage(value: unknown): AppLanguage {
  const raw = String(value || "").toLowerCase();
  return raw === "en" || raw === "en-us" || raw === "english" ? "en-US" : "zh-CN";
}

function initialLanguage(): AppLanguage {
  if (typeof window === "undefined") return "zh-CN";
  return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
}

function preserveWhitespace(source: string, translated: string) {
  const leading = source.match(/^\s*/)?.[0] || "";
  const trailing = source.match(/\s*$/)?.[0] || "";
  return `${leading}${translated}${trailing}`;
}

function translateDynamicText(value: string) {
  const rules: Array<[RegExp, (...parts: string[]) => string]> = [
    [/^(\d+)\s*秒前$/, (count) => `${count} seconds ago`],
    [/^(\d+)\s*分钟前$/, (count) => `${count} minutes ago`],
    [/^(\d+)\s*小时前$/, (count) => `${count} hours ago`],
    [/^(\d+)\s*天前$/, (count) => `${count} days ago`],
    [/^上次扫描\s+(.+)$/, (time) => `Last scan ${translateText(time)}`],
    [/^多选\s*\((\d+)\)$/, (count) => `Select multiple (${count})`],
    [/^共\s*(\d+)\s*条规则$/, (count) => `${count} rule sources`],
    [/^拖动\s+(.+)\s+到当前名单$/, (name) => `Drag ${name} to the current list`],
    [/^拖动\s+(.+)\s+回客户端列表$/, (name) => `Drag ${name} back to clients`],
    [/^加入(白名单|黑名单)$/, (list) => `Add to ${list === "白名单" ? "allowlist" : "blocklist"}`],
    [/^部分规则源更新失败：(.+)$/, (names) => `Some rule sources failed to update: ${names}`],
    [/^(.+)\s+·\s+(\d+)\s*天前$/, (prefix, count) => `${prefix} · ${count} days ago`],
    [/^(\d+)\s*天\s*(\d+)\s*小时$/, (days, hours) => `${days} days ${hours} hours`],
    [/^总计\s+(.+)$/, (total) => `Total ${total}`],
    [/^内存使用\s+(.+)$/, (memory) => `Memory ${memory}`],
    [/^总请求\s+(\d+),\s*命中\s+(\d+)$/, (total, hits) => `${total} requests, ${hits} hits`],
    [/^策略组\s*(\d+)$/, (count) => `${count} groups`],
    [/^供应商\s*(\d+)$/, (count) => `${count} providers`],
    [/^命中\s*(\d+)$/, (count) => `${count} hits`],
  ];
  for (const [pattern, render] of rules) {
    const match = value.match(pattern);
    if (match) return render(...match.slice(1));
  }
  return value;
}

export function translateText(source: string) {
  const trimmed = source.trim();
  if (!trimmed) return source;
  const translated = translations[trimmed] || translateDynamicText(trimmed);
  return translated === trimmed ? source : preserveWhitespace(source, translated);
}

function shouldIgnore(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return Boolean(element?.closest(ignoredSelector));
}

function localizeDocument(language: AppLanguage) {
  const textOriginals = new Map<Text, string>();
  const attributeOriginals = new Map<Element, Map<string, string>>();
  const attributes = ["aria-label", "title", "placeholder"];

  const translateElement = (element: Element) => {
    if (element.matches(ignoredSelector) || element.closest(ignoredSelector)) return;
    for (const attribute of attributes) {
      const current = element.getAttribute(attribute);
      if (!current) continue;
      const translated = translateText(current);
      if (translated === current) continue;
      const originals = attributeOriginals.get(element) || new Map<string, string>();
      originals.set(attribute, current);
      attributeOriginals.set(element, originals);
      element.setAttribute(attribute, translated);
    }
  };

  const translateNode = (root: Node) => {
    if (shouldIgnore(root)) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const text = root as Text;
      const current = text.nodeValue || "";
      const existing = textOriginals.get(text);
      if (existing && current === translateText(existing)) return;
      const translated = translateText(current);
      if (translated !== current) {
        textOriginals.set(text, current);
        text.nodeValue = translated;
      }
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) translateElement(root as Element);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      if (current.nodeType === Node.TEXT_NODE) {
        translateNode(current);
      } else {
        translateElement(current as Element);
      }
      current = walker.nextNode();
    }
  };

  if (language === "en-US") translateNode(document.body);
  const observer = new MutationObserver((mutations) => {
    if (language !== "en-US") return;
    for (const mutation of mutations) {
      if (mutation.type === "characterData") translateNode(mutation.target);
      mutation.addedNodes.forEach(translateNode);
      if (mutation.type === "attributes") translateElement(mutation.target as Element);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: attributes });

  return () => {
    observer.disconnect();
    textOriginals.forEach((original, node) => {
      if (node.isConnected) node.nodeValue = original;
    });
    attributeOriginals.forEach((originals, element) => {
      if (!element.isConnected) return;
      originals.forEach((original, attribute) => element.setAttribute(attribute, original));
    });
  };
}

interface LanguageContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  isEnglish: boolean;
  t: (source: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(initialLanguage);
  const setLanguage = useCallback((next: AppLanguage) => setLanguageState(normalizeLanguage(next)), []);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    return localizeDocument(language);
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    isEnglish: language === "en-US",
    t: (source) => language === "en-US" ? translateText(source) : source,
  }), [language, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}
