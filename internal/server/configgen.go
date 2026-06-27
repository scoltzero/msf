package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type SetupConfig struct {
	Username                 string `json:"username"`
	Password                 string `json:"password"`
	ConfirmPassword          string `json:"confirmPassword"`
	Email                    string `json:"email"`
	Timezone                 string `json:"timezone"`
	WebPort                  string `json:"webPort"`
	AMD64v3Enabled           bool   `json:"amd64v3_enabled"`
	SelectedInterface        string `json:"selected_interface"`
	MihomoCoreType           string `json:"mihomo_core_type"`
	AutoSetDNS               bool   `json:"auto_set_dns"`
	DNSOn                    string `json:"dns_on"`
	DNSOff                   string `json:"dns_off"`
	EnableIPv6               bool   `json:"enableIPv6"`
	FakeIPRangeV4            string `json:"fakeIPRangeV4"`
	FakeIPRangeV6            string `json:"fakeIPRangeV6"`
	LinuxProxyMode           string `json:"linux_proxy_mode"`
	NFTProxyPolicy           string `json:"nft_proxy_policy"`
	ProxyCore                string `json:"proxyCore"`
	MosDNSEnabled            bool   `json:"mosdnsEnabled"`
	SubscriptionURLs         string `json:"subscription_urls"`
	MihomoProxies            string `json:"mihomo_proxies"`
	GitHubProxyEnabled       bool   `json:"github_proxy_enabled"`
	GitHubHTTPSProxy         string `json:"github_https_proxy"`
	GitHubHTTPProxy          string `json:"github_http_proxy"`
	GitHubSocks5Proxy        string `json:"github_socks5_proxy"`
	GitHubAcceleratorEnabled bool   `json:"github_accelerator_enabled"`
	GitHubAcceleratorURL     string `json:"github_accelerator_url"`
}

func (c *SetupConfig) defaults() {
	if c.Timezone == "" {
		c.Timezone = "Asia/Shanghai"
	}
	if c.WebPort == "" {
		c.WebPort = "7777"
	}
	if c.MihomoCoreType == "" {
		c.MihomoCoreType = "meta"
	}
	if c.DNSOn == "" {
		c.DNSOn = "127.0.0.1"
	}
	if c.DNSOff == "" {
		c.DNSOff = "223.5.5.5"
	}
	if c.FakeIPRangeV4 == "" {
		c.FakeIPRangeV4 = "28.0.0.0/8"
	}
	if c.FakeIPRangeV6 == "" {
		c.FakeIPRangeV6 = "f2b0::/18"
	}
	if c.LinuxProxyMode == "" {
		if IsDockerRuntime() {
			c.LinuxProxyMode = "tun"
		} else {
			c.LinuxProxyMode = "nft"
		}
	}
	if c.NFTProxyPolicy == "" {
		c.NFTProxyPolicy = "direct_default"
	}
	if c.ProxyCore == "" || c.ProxyCore == "singbox" {
		c.ProxyCore = "mihomo"
	}
	c.MosDNSEnabled = true
}

func isTUNProxyMode(mode string) bool {
	return strings.EqualFold(strings.TrimSpace(mode), "tun")
}

func isNFTProxyMode(mode string) bool {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "", "nft", "nftables", "tproxy":
		return true
	default:
		return false
	}
}

func (a *App) ensureDefaultConfigs() error {
	cfg := SetupConfig{
		Timezone:          "Asia/Shanghai",
		WebPort:           "7777",
		SelectedInterface: "eth0",
		MihomoCoreType:    "meta",
		AutoSetDNS:        true,
		EnableIPv6:        true,
		ProxyCore:         "mihomo",
		MosDNSEnabled:     true,
	}
	cfg.defaults()
	if err := a.ensureMSSBTemplateDefaults(false); err != nil {
		return err
	}
	files := map[string]string{
		"configs/app.yaml":             a.renderAppYAML(cfg),
		"configs/mosdns/config.yaml":   a.renderMosDNSYAML(cfg),
		"configs/network/network.yaml": a.renderNetworkYAML(cfg),
		"configs/singbox/config.json":  renderDisabledSingBoxJSON(),
	}
	if shouldRestoreNFT(cfg) {
		files["configs/network/network.nft"] = a.renderNFT(cfg)
	}
	if a.mihomoConfigMode() != "custom" {
		files["configs/mihomo/config.yaml"] = a.renderMihomoYAML(cfg)
	}
	for rel, content := range files {
		path := filepath.Join(a.DataDir, rel)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				return err
			}
			if err := os.WriteFile(path, []byte(content), 0644); err != nil {
				return err
			}
		}
	}
	if err := a.ensureMosDNSRuleFiles(); err != nil {
		return err
	}
	if a.mihomoConfigMode() != "custom" {
		a.ensureGeneratedMihomoConfigCompatibility()
	}
	return nil
}

func (a *App) writeGeneratedConfigs(cfg SetupConfig) error {
	cfg.defaults()
	if err := a.ensureMSSBTemplateDefaults(true); err != nil {
		return err
	}
	files := map[string]string{
		"configs/app.yaml":             a.renderAppYAML(cfg),
		"configs/mosdns/config.yaml":   a.renderMosDNSYAML(cfg),
		"configs/network/network.yaml": a.renderNetworkYAML(cfg),
		"configs/singbox/config.json":  renderDisabledSingBoxJSON(),
	}
	if shouldRestoreNFT(cfg) {
		files["configs/network/network.nft"] = a.renderNFT(cfg)
	}
	if a.mihomoConfigMode() != "custom" {
		files["configs/mihomo/config.yaml"] = a.renderMihomoYAML(cfg)
	}
	if manual := renderMihomoManualProviderYAML(cfg.MihomoProxies); strings.TrimSpace(manual) != "" {
		files["configs/mihomo/proxy_providers/msf_manual.yaml"] = manual
	}
	for rel, content := range files {
		if err := a.writeTextFile(rel, content); err != nil {
			return err
		}
	}
	if err := a.ensureMosDNSRuleFiles(); err != nil {
		return err
	}
	return nil
}

func renderDisabledSingBoxJSON() string {
	return `{
  "log": {
    "level": "info",
    "timestamp": true
  },
  "dns": {
    "servers": [
      {
        "tag": "local",
        "address": "223.5.5.5"
      }
    ]
  },
  "inbounds": [],
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    }
  ],
  "route": {
    "rules": [],
    "final": "direct"
  }
}
`
}

func (a *App) renderAppYAML(cfg SetupConfig) string {
	return fmt.Sprintf(`server:
  host: 0.0.0.0
  port: %s
  mode: release
  enable_https: false
system:
  timezone: %s
jwt:
  secret: %s
`, cfg.WebPort, cfg.Timezone, string(a.Secret))
}

func (a *App) renderMihomoYAML(cfg SetupConfig) string {
	if template, ok := mssbTemplateText("mihomo/config.yaml"); ok {
		return renderMihomoTemplate(template, cfg)
	}
	return renderMihomoFallbackYAML(cfg)
}

func renderMihomoTemplate(template string, cfg SetupConfig) string {
	content := template
	ipv6 := boolYAML(cfg.EnableIPv6)
	content = strings.Replace(content, "interface-name: eth0", "interface-name: "+selectedInterface(cfg.SelectedInterface), 1)
	content = strings.ReplaceAll(content, "ipv6: true", "ipv6: "+ipv6)
	content = strings.Replace(content, "external-ui: /mssb/mihomo/ui", "external-ui: ui", 1)
	content = strings.Replace(content, "fake-ip-range: 28.0.0.1/8", "fake-ip-range: "+normalizeMihomoFakeIPv4Range(cfg.FakeIPRangeV4), 1)
	content = applyMihomoProxyMode(content, cfg)
	return replaceMihomoProxyProviders(content, renderProxyProvidersYAML(parseSubscriptionProviders(cfg.SubscriptionURLs), hasMihomoManualProxies(cfg.MihomoProxies)))
}

func renderMihomoFallbackYAML(cfg SetupConfig) string {
	providerYAML := renderProxyProvidersYAML(parseSubscriptionProviders(cfg.SubscriptionURLs), hasMihomoManualProxies(cfg.MihomoProxies))
	ipv6 := boolYAML(cfg.EnableIPv6)
	transparentYAML := renderMihomoTransparentProxyYAML(cfg)
	tunYAML := renderMihomoTunYAML(isTUNProxyMode(cfg.LinuxProxyMode))
	return fmt.Sprintf(`# msf generated Mihomo config
mode: rule
log-level: info
unified-delay: true
tcp-concurrent: true
interface-name: %s
ipv6: %s
udp: true
port: 7890
socks-port: 7891
mixed-port: 7892
%s
geodata-mode: true
geodata-loader: standard
geo-auto-update: false
geo-update-interval: 24
find-process-mode: strict
allow-lan: true
bind-address: "*"
external-controller: :9090
external-ui: ui
external-ui-url: https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip
geox-url:
  geoip: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat"
  geosite: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat"
  mmdb: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.metadb"
  asn: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb"
profile:
  store-selected: true
  store-fake-ip: true
sniffer:
  enable: false
%s
dns:
  enable: true
  listen: 0.0.0.0:6666
  ipv6: %s
  enhanced-mode: fake-ip
  fake-ip-range: %s
  fake-ip-filter:
    - "*"
    - +.lan
  default-nameserver:
    - 127.0.0.1:8888
proxy-groups:
  - {name: 节点选择, type: select, proxies: [手动切换, 全球直连]}
  - {name: 手动切换, type: select, proxies: [DIRECT], include-all: true, include-all-proxies: true, include-all-providers: true}
  - {name: 漏网之鱼, type: select, proxies: [节点选择, 全球直连]}
  - {name: 全球直连, type: select, proxies: [DIRECT]}
rules:
  - DOMAIN-SUFFIX,lan,全球直连
  - IP-CIDR,10.0.0.0/8,全球直连,no-resolve
  - IP-CIDR,172.16.0.0/12,全球直连,no-resolve
  - IP-CIDR,192.168.0.0/16,全球直连,no-resolve
  - IP-CIDR,127.0.0.0/8,全球直连,no-resolve
  - IP-CIDR,8.8.8.8/32,节点选择
  - IP-CIDR,1.1.1.1/32,节点选择
  - MATCH,节点选择
%s`, selectedInterface(cfg.SelectedInterface), ipv6, transparentYAML, tunYAML, ipv6, normalizeMihomoFakeIPv4Range(cfg.FakeIPRangeV4), providerYAML)
}

func renderMihomoTransparentProxyYAML(cfg SetupConfig) string {
	if isTUNProxyMode(cfg.LinuxProxyMode) {
		return ""
	}
	return "redir-port: 7877\ntproxy-port: 7896\nrouting-mark: 1"
}

func renderMihomoTunYAML(enabled bool) string {
	if !enabled {
		return "tun:\n  enable: false"
	}
	return `tun:
  enable: true
  stack: mixed
  device: mihomo
  auto-route: true
  auto-detect-interface: true
  strict-route: false
  auto-redirect: false
  dns-hijack:
    - any:53`
}

func applyMihomoProxyMode(content string, cfg SetupConfig) string {
	if isTUNProxyMode(cfg.LinuxProxyMode) {
		content = removeTopLevelYAMLKeys(content, map[string]bool{
			"redir-port":   true,
			"tproxy-port":  true,
			"routing-mark": true,
		})
		return replaceTopLevelYAMLBlock(content, "tun", renderMihomoTunYAML(true))
	}
	return replaceTopLevelYAMLBlock(content, "tun", renderMihomoTunYAML(false))
}

func removeTopLevelYAMLKeys(content string, keys map[string]bool) string {
	var out strings.Builder
	for _, line := range strings.SplitAfter(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") {
			out.WriteString(line)
			continue
		}
		key, _, ok := strings.Cut(trimmed, ":")
		if ok && keys[strings.TrimSpace(key)] {
			continue
		}
		out.WriteString(line)
	}
	return out.String()
}

func replaceTopLevelYAMLBlock(content, key, replacement string) string {
	lines := strings.SplitAfter(content, "\n")
	var out strings.Builder
	replaced := false
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if !replaced && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") && strings.HasPrefix(trimmed, key+":") {
			out.WriteString(strings.TrimRight(replacement, "\n"))
			out.WriteByte('\n')
			replaced = true
			for i+1 < len(lines) {
				next := lines[i+1]
				nextTrimmed := strings.TrimSpace(next)
				if nextTrimmed == "" || strings.HasPrefix(next, " ") || strings.HasPrefix(next, "\t") {
					i++
					continue
				}
				break
			}
			continue
		}
		out.WriteString(line)
	}
	if !replaced {
		out.WriteString(strings.TrimRight(replacement, "\n"))
		out.WriteByte('\n')
	}
	return out.String()
}

func renderProxyProvidersYAML(providers map[string]string, includeManual bool) string {
	if len(providers) == 0 && !includeManual {
		return "proxy-providers: {}\n"
	}
	var b strings.Builder
	b.WriteString("proxy-providers:\n")
	if includeManual {
		b.WriteString("  msf_manual:\n    type: file\n    path: './proxy_providers/msf_manual.yaml'\n    health-check:\n      enable: true\n      url: http://detectportal.firefox.com/success.txt\n      interval: 120\n")
	}
	keys := make([]string, 0, len(providers))
	for k := range providers {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, tag := range keys {
		subscriptionURL := providers[tag]
		b.WriteString(fmt.Sprintf("  %q:\n    type: http\n    url: %q\n    interval: 3600\n    path: './proxy_providers/%s.yaml'\n    health-check:\n      enable: true\n      url: http://detectportal.firefox.com/success.txt\n      interval: 120\n", tag, subscriptionURL, safeFilename(tag)))
	}
	return b.String()
}

func (a *App) renderMosDNSYAML(cfg SetupConfig) string {
	if template, ok := mssbTemplateText("mosdns/config.yaml"); ok {
		logPath := filepath.ToSlash(filepath.Join(a.DataDir, "logs/mosdns.log"))
		content := strings.Replace(template, `file: "/tmp/mosdns.log"`, fmt.Sprintf(`file: "%s"`, logPath), 1)
		if !strings.Contains(content, "tag: udp_main") {
			content = strings.Replace(content, "\n  - tag: sequence_requery", mssbMainSplitServerYAML()+"\n  - tag: sequence_requery", 1)
		}
		content = strings.ReplaceAll(content, "28.0.0.0/8", fakeIPv4RouteCIDR(cfg.FakeIPRangeV4))
		content = strings.ReplaceAll(content, "2001:2::/64", fakeIPv6RouteCIDR(cfg.FakeIPRangeV6))
		content = strings.ReplaceAll(content, "f2b0::/18", fakeIPv6RouteCIDR(cfg.FakeIPRangeV6))
		return content
	}
	return fmt.Sprintf(`log:
  level: warn
  file: "%s"
api:
  http: "0.0.0.0:9099"
include:
  - "sub_config/switch.yaml"
  - "sub_config/forward_local.yaml"
  - "sub_config/forward_remote.yaml"
plugins:
  - tag: blocklist
    type: domain_set
    args:
      files:
        - "rules/blocklist.txt"
  - tag: client_ip
    type: ip_set
    args:
      files:
        - "client_ip.txt"
  - tag: forward_local
    type: forward
    args:
      concurrent: 2
      upstreams:
        - addr: "udp://223.5.5.5"
        - addr: "udp://119.29.29.29"
  - tag: forward_remote
    type: forward
    args:
      concurrent: 2
      upstreams:
        - addr: "udp://127.0.0.1:6666"
  - tag: sequence_main
    type: sequence
    args:
      - matches:
          - qname $blocklist
        exec: reject 0
      - matches:
          - client_ip $client_ip
        exec: $forward_remote
      - exec: $forward_local
  - tag: udp_all
    type: udp_server
    args:
      entry: sequence_main
      listen: ":53"
      enable_audit: true
  - tag: tcp_all
    type: tcp_server
    args:
      entry: sequence_main
      listen: ":53"
      enable_audit: true
`, filepath.ToSlash(filepath.Join(a.DataDir, "logs/mosdns.log")))
}

func mssbMainSplitServerYAML() string {
	return `
  - tag: forward_all_in
    type: forward
    args:
      concurrent: 1
      upstreams:
        - addr: "udp://127.0.0.1:5656"

  - tag: udp_main
    type: udp_server
    args:
      entry: sequence_6666
      listen: 127.0.0.1:5656

  - tag: tcp_main
    type: tcp_server
    args:
      entry: sequence_6666
      listen: 127.0.0.1:5656
      idle_timeout: 720
`
}

func (a *App) renderNetworkYAML(cfg SetupConfig) string {
	v := map[string]any{
		"mode":            cfg.LinuxProxyMode,
		"proxy_policy":    cfg.NFTProxyPolicy,
		"interface":       cfg.SelectedInterface,
		"allow_dns":       true,
		"dns_ports":       []int{53, 5353},
		"system_dns_on":   cfg.DNSOn,
		"system_dns_off":  cfg.DNSOff,
		"auto_system_dns": cfg.AutoSetDNS,
		"fake_ipv4":       []string{fakeIPv4RouteCIDR(cfg.FakeIPRangeV4)},
		"fake_ipv6":       []string{fakeIPv6RouteCIDR(cfg.FakeIPRangeV6)},
	}
	if !isTUNProxyMode(cfg.LinuxProxyMode) {
		v["mode"] = "tproxy"
		v["mark"] = 1
		v["table"] = 100
		v["tproxy_port"] = 7896
		v["ipv4"] = map[string]any{"enable": true, "listen_port": 7877}
		v["ipv6"] = map[string]any{"enable": cfg.EnableIPv6, "listen_port": 7877}
	}
	b, _ := yaml.Marshal(v)
	return string(b)
}

func (a *App) renderNFT(cfg SetupConfig) string {
	ifaceSet := nftInterfaceSet(cfg.SelectedInterface)
	return fmt.Sprintf(`#!/usr/sbin/nft -f
table inet msf {
  set local_ipv4 {
    type ipv4_addr
    flags interval
    elements = { 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4 }
  }

  set local_ipv6 {
    type ipv6_addr
    flags interval
    elements = { ::ffff:0.0.0.0/96, 64:ff9b::/96, 100::/64, 2001::/32, 2001:10::/28, 2001:20::/28, 2001:db8::/32, 2002::/16, fc00::/7, fe80::/10 }
  }

  set china_dns_ipv4 {
    type ipv4_addr
    elements = { 221.130.33.60, 223.5.5.5, 223.6.6.6, 119.29.29.29, 119.28.28.28, 114.114.114.114, 114.114.115.115 }
  }

  set china_dns_ipv6 {
    type ipv6_addr
    elements = { 2400:3200::1, 2400:3200:baba::1, 2402:4e00:: }
  }

  set dns_ipv4 {
    type ipv4_addr
    flags interval
    elements = { 8.8.8.8/32, 8.8.4.4/32, 1.0.0.1/32, 1.1.1.1/32, 9.9.9.9/32 }
  }

  set dns_ipv6 {
    type ipv6_addr
    flags interval
    elements = { 2001:4860:4860::8888/128, 2001:4860:4860::8844/128, 2606:4700:4700::1111/128, 2606:4700:4700::1001/128 }
  }

  set fake_ipv4 {
    type ipv4_addr
    flags interval
    elements = { %s }
  }

  set fake_ipv6 {
    type ipv6_addr
    flags interval
    elements = { %s }
  }

  chain nat-prerouting {
    type nat hook prerouting priority dstnat; policy accept;
    fib daddr type { unspec, local, anycast, multicast } return
    ip daddr @local_ipv4 return
    ip6 daddr @local_ipv6 return
    ip daddr @china_dns_ipv4 return
    ip6 daddr @china_dns_ipv6 return
    udp dport { 123 } return
    udp dport { 53 } accept
    ip daddr @dns_ipv4 meta l4proto tcp redirect to :7877
    ip6 daddr @dns_ipv6 meta l4proto tcp redirect to :7877
    iifname { %s } meta l4proto tcp redirect to :7877
  }

  chain nat-output {
    type nat hook output priority filter; policy accept;
    fib daddr type { unspec, local, anycast, multicast } return
    ip daddr @fake_ipv4 meta l4proto tcp redirect to :7877
    ip6 daddr @fake_ipv6 meta l4proto tcp redirect to :7877
  }

  chain proxy-tproxy {
    fib daddr type { unspec, local, anycast, multicast } return
    ip daddr @local_ipv4 return
    ip6 daddr @local_ipv6 return
    ip daddr @china_dns_ipv4 return
    ip6 daddr @china_dns_ipv6 return
    udp dport { 123 } return
    udp dport { 53 } accept
    meta l4proto udp meta mark set 1 tproxy to :7896 accept
  }

  chain proxy-mark {
    fib daddr type { unspec, local, anycast, multicast } return
    ip daddr @local_ipv4 return
    ip6 daddr @local_ipv6 return
    ip daddr @china_dns_ipv4 return
    ip6 daddr @china_dns_ipv6 return
    udp dport { 123 } return
    udp dport { 53 } accept
    meta mark set 1
  }

  chain mangle-output {
    type route hook output priority mangle; policy accept;
    meta l4proto udp skgid != 1 ct direction original goto proxy-mark
  }

  chain mangle-prerouting {
    type filter hook prerouting priority mangle; policy accept;
    ip daddr @dns_ipv4 meta l4proto udp ct direction original goto proxy-tproxy
    ip6 daddr @dns_ipv6 meta l4proto udp ct direction original goto proxy-tproxy
    iifname { %s } meta l4proto udp ct direction original goto proxy-tproxy
  }
}
`, fakeIPv4RouteCIDR(cfg.FakeIPRangeV4), fakeIPv6RouteCIDR(cfg.FakeIPRangeV6), ifaceSet, ifaceSet)
}

func (a *App) ensureMosDNSRuleFiles() error {
	files := map[string]string{
		"configs/mosdns/client_ip.txt":      "",
		"configs/mosdns/rule/blocklist.txt": "",
	}
	for rel, content := range files {
		path := filepath.Join(a.DataDir, rel)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				return err
			}
			if err := os.WriteFile(path, []byte(content), 0644); err != nil {
				return err
			}
		}
	}
	defaults := defaultMosDNSSwitchStates()
	for i := 1; i <= 15; i++ {
		key := fmt.Sprintf("switch%d", i)
		_, _ = a.DB.Exec(`insert or ignore into mosdns_switch_states(switch_key,enabled,created_at,updated_at) values(?,?,?,?)`, key, defaults[key], nowString(), nowString())
	}
	return nil
}

func replaceMihomoProxyProviders(content, providersYAML string) string {
	marker := "\n# 节点订阅\nproxy-providers:"
	if idx := strings.Index(content, marker); idx >= 0 {
		return strings.TrimRight(content[:idx], "\n") + "\n\n# 节点订阅\n" + strings.TrimRight(providersYAML, "\n") + "\n"
	}
	if idx := strings.LastIndex(content, "\nproxy-providers:"); idx >= 0 {
		return strings.TrimRight(content[:idx], "\n") + "\n\n" + strings.TrimRight(providersYAML, "\n") + "\n"
	}
	return strings.TrimRight(content, "\n") + "\n\n" + strings.TrimRight(providersYAML, "\n") + "\n"
}

func boolYAML(v bool) string {
	if v {
		return "true"
	}
	return "false"
}

func selectedInterface(iface string) string {
	if iface == "" {
		return "eth0"
	}
	return iface
}

func normalizeMihomoFakeIPv4Range(v string) string {
	v = strings.TrimSpace(v)
	switch v {
	case "", "28.0.0.0/8":
		return "28.0.0.1/8"
	default:
		return v
	}
}

func fakeIPv4RouteCIDR(v string) string {
	v = normalizeMihomoFakeIPv4Range(v)
	if p, err := netip.ParsePrefix(v); err == nil {
		return p.Masked().String()
	}
	if addr, err := netip.ParseAddr(v); err == nil && addr.Is4() {
		return netip.PrefixFrom(addr, 8).Masked().String()
	}
	return "28.0.0.0/8"
}

func fakeIPv6RouteCIDR(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		v = "f2b0::/18"
	}
	if p, err := netip.ParsePrefix(v); err == nil {
		return p.Masked().String()
	}
	if addr, err := netip.ParseAddr(v); err == nil && addr.Is6() {
		return netip.PrefixFrom(addr, 64).Masked().String()
	}
	return "f2b0::/18"
}

func nftInterfaceSet(iface string) string {
	seen := map[string]bool{}
	var values []string
	for _, item := range []string{"lo", selectedInterface(iface)} {
		item = strings.TrimSpace(item)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		values = append(values, fmt.Sprintf("%q", item))
	}
	return strings.Join(values, ", ")
}

func defaultMosDNSSwitchStates() map[string]bool {
	return map[string]bool{
		"switch1": true, "switch2": false, "switch3": true, "switch4": true, "switch5": true,
		"switch6": false, "switch7": true, "switch8": false, "switch9": true, "switch10": false,
		"switch11": true, "switch12": false, "switch13": true, "switch14": true, "switch15": true,
	}
}

func parseSubscriptionProviders(input string) map[string]string {
	out := map[string]string{}
	idx := 0
	normalized, err := normalizeSubscriptionURLsValue(input)
	if err != nil {
		return out
	}
	for _, item := range strings.Fields(normalized) {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		tag, url := "", item
		if strings.Contains(item, "|") {
			parts := strings.SplitN(item, "|", 2)
			tag, url = strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		}
		if tag == "" {
			idx++
			tag = fmt.Sprintf("机场%d", idx)
		}
		if url != "" {
			out[tag] = url
		}
	}
	return out
}

func normalizeSubscriptionURLsValue(value any) (string, error) {
	switch v := value.(type) {
	case nil:
		return "", nil
	case []any:
		return normalizeSubscriptionURLItems(v)
	case []string:
		items := make([]any, 0, len(v))
		for _, item := range v {
			items = append(items, item)
		}
		return normalizeSubscriptionURLItems(items)
	case map[string]any:
		return normalizeSubscriptionURLItems([]any{v})
	case string:
		return normalizeSubscriptionURLString(v)
	default:
		return normalizeSubscriptionURLString(fmtAny(v))
	}
}

func normalizeSubscriptionURLString(input string) (string, error) {
	input = strings.TrimSpace(input)
	if input == "" {
		return "", nil
	}
	if strings.HasPrefix(input, "[") {
		var items []any
		if err := json.Unmarshal([]byte(input), &items); err == nil {
			return normalizeSubscriptionURLItems(items)
		}
	}
	if strings.HasPrefix(input, "{") {
		var item map[string]any
		if err := json.Unmarshal([]byte(input), &item); err == nil {
			return normalizeSubscriptionURLItems([]any{item})
		}
	}
	items := make([]any, 0)
	for _, item := range strings.Fields(input) {
		items = append(items, item)
	}
	return normalizeSubscriptionURLItems(items)
}

func normalizeSubscriptionURLItems(items []any) (string, error) {
	rows := make([]string, 0, len(items))
	for _, raw := range items {
		row, err := normalizeSubscriptionURLItem(raw)
		if err != nil {
			return "", err
		}
		if row != "" {
			rows = append(rows, row)
		}
	}
	return strings.Join(rows, "\n"), nil
}

func normalizeSubscriptionURLItem(raw any) (string, error) {
	switch v := raw.(type) {
	case nil:
		return "", nil
	case string:
		return normalizeSubscriptionURLToken(v)
	case map[string]any:
		tag := firstSubscriptionString(v, "tag", "name", "label", "title")
		rawURL := firstSubscriptionString(v, "url", "subscription_url", "subscriptionURL", "href")
		return formatSubscriptionURLRow(tag, rawURL)
	default:
		return normalizeSubscriptionURLToken(fmtAny(v))
	}
}

func normalizeSubscriptionURLToken(token string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", nil
	}
	tag, rawURL := "", token
	if strings.Contains(token, "|") {
		parts := strings.SplitN(token, "|", 2)
		tag = strings.TrimSpace(parts[0])
		rawURL = strings.TrimSpace(parts[1])
	}
	return formatSubscriptionURLRow(tag, rawURL)
}

func formatSubscriptionURLRow(tag, rawURL string) (string, error) {
	tag = cleanSubscriptionTag(tag)
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", nil
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" || !oneOf(strings.ToLower(u.Scheme), "http", "https") {
		return "", fmt.Errorf("invalid subscription url")
	}
	if tag == "" {
		return rawURL, nil
	}
	return tag + "|" + rawURL, nil
}

func firstSubscriptionString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key]; ok {
			return strings.TrimSpace(fmtAny(value))
		}
	}
	return ""
}

func cleanSubscriptionTag(tag string) string {
	tag = strings.TrimSpace(tag)
	tag = strings.ReplaceAll(tag, "|", "-")
	tag = strings.ReplaceAll(tag, "\r", " ")
	tag = strings.ReplaceAll(tag, "\n", " ")
	return strings.Join(strings.Fields(tag), " ")
}

func hasMihomoManualProxies(input string) bool {
	return strings.TrimSpace(input) != ""
}

func renderMihomoManualProviderYAML(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}
	if strings.HasPrefix(input, "proxies:") {
		return strings.TrimRight(input, "\n") + "\n"
	}
	if strings.HasPrefix(input, "- ") {
		return "proxies:\n" + indentYAML(input, 2)
	}
	proxies := parseMihomoManualProxyLinks(input)
	if len(proxies) == 0 {
		return "proxies: []\n"
	}
	payload := map[string]any{"proxies": proxies}
	b, err := yaml.Marshal(payload)
	if err != nil {
		return "proxies: []\n"
	}
	return string(b)
}

func parseMihomoManualProxyLinks(input string) []map[string]any {
	var proxies []map[string]any
	for _, token := range strings.Fields(input) {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		if proxy, ok := parseMihomoManualProxyLink(token); ok {
			proxies = append(proxies, proxy)
		}
	}
	return proxies
}

func parseMihomoManualProxyLink(raw string) (map[string]any, bool) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil {
		return nil, false
	}
	switch strings.ToLower(u.Scheme) {
	case "ss", "shadowsocks":
		return parseSSProxyLink(raw, u)
	case "ssr":
		return parseSSRProxyLink(raw, u)
	case "vmess":
		return parseVMessProxyLink(raw, u)
	case "vless":
		return parseVLESSProxyLink(u)
	case "trojan":
		return parseTrojanProxyLink(u)
	case "hysteria", "hy":
		return parseHysteriaProxyLink(u, "hysteria")
	case "hysteria2", "hy2":
		return parseHysteriaProxyLink(u, "hysteria2")
	case "tuic":
		return parseTUICProxyLink(u)
	default:
		return nil, false
	}
}

func parseSSProxyLink(raw string, u *url.URL) (map[string]any, bool) {
	server := u.Hostname()
	port := parseProxyPort(u.Port(), 0)
	auth := u.User.Username()
	if password, ok := u.User.Password(); ok {
		auth = auth + ":" + password
	}
	if decoded, ok := decodeProxyBase64(auth); ok {
		auth = decoded
	}
	if server == "" || port <= 0 || !strings.Contains(auth, ":") {
		payload := strings.TrimPrefix(raw, "ss://")
		if hash := strings.Index(payload, "#"); hash >= 0 {
			payload = payload[:hash]
		}
		if query := strings.Index(payload, "?"); query >= 0 {
			payload = payload[:query]
		}
		if at := strings.LastIndex(payload, "@"); at >= 0 {
			auth = payload[:at]
			hostPort := payload[at+1:]
			if decoded, ok := decodeProxyBase64(auth); ok {
				auth = decoded
			}
			server, port = splitProxyHostPort(hostPort, 8388)
		} else if decoded, ok := decodeProxyBase64(payload); ok {
			if at := strings.LastIndex(decoded, "@"); at >= 0 {
				auth = decoded[:at]
				server, port = splitProxyHostPort(decoded[at+1:], 8388)
			}
		}
	}
	method, password, ok := strings.Cut(auth, ":")
	if !ok || server == "" || port <= 0 || method == "" || password == "" {
		return nil, false
	}
	return map[string]any{
		"name":     manualProxyName(u.Fragment, server),
		"type":     "ss",
		"server":   server,
		"port":     port,
		"cipher":   method,
		"password": password,
		"udp":      true,
	}, true
}

func parseSSRProxyLink(raw string, u *url.URL) (map[string]any, bool) {
	payload := strings.TrimPrefix(raw, "ssr://")
	if decoded, ok := decodeProxyBase64(payload); ok {
		payload = decoded
	}
	mainPart, queryPart, _ := strings.Cut(payload, "/?")
	parts := strings.Split(mainPart, ":")
	if len(parts) < 6 {
		return nil, false
	}
	port := parseProxyPort(parts[1], 0)
	password, _ := decodeProxyBase64(parts[5])
	if password == "" {
		password = parts[5]
	}
	q, _ := url.ParseQuery(queryPart)
	remarks, _ := decodeProxyBase64(q.Get("remarks"))
	name := manualProxyName(u.Fragment, firstNonEmpty(remarks, parts[0]))
	proxy := map[string]any{
		"name":     name,
		"type":     "ssr",
		"server":   parts[0],
		"port":     port,
		"protocol": parts[2],
		"cipher":   parts[3],
		"obfs":     parts[4],
		"password": password,
		"udp":      true,
	}
	if protocolParam, ok := decodeProxyBase64(q.Get("protoparam")); ok && protocolParam != "" {
		proxy["protocol-param"] = protocolParam
	}
	if obfsParam, ok := decodeProxyBase64(q.Get("obfsparam")); ok && obfsParam != "" {
		proxy["obfs-param"] = obfsParam
	}
	return proxy, parts[0] != "" && port > 0 && password != ""
}

func parseVMessProxyLink(raw string, u *url.URL) (map[string]any, bool) {
	payload := strings.TrimPrefix(raw, "vmess://")
	decoded, ok := decodeProxyBase64(payload)
	if !ok {
		return nil, false
	}
	var data map[string]any
	if err := json.Unmarshal([]byte(decoded), &data); err != nil {
		return nil, false
	}
	server := stringAny(data["add"])
	port := parseProxyPort(stringAny(data["port"]), 443)
	uuid := stringAny(data["id"])
	if server == "" || port <= 0 || uuid == "" {
		return nil, false
	}
	network := firstNonEmpty(stringAny(data["net"]), "tcp")
	proxy := map[string]any{
		"name":    manualProxyName(u.Fragment, firstNonEmpty(stringAny(data["ps"]), server)),
		"type":    "vmess",
		"server":  server,
		"port":    port,
		"uuid":    uuid,
		"alterId": intStringAny(data["aid"], 0),
		"cipher":  firstNonEmpty(stringAny(data["scy"]), "auto"),
		"network": network,
		"udp":     true,
	}
	if tls := strings.ToLower(stringAny(data["tls"])); tls == "tls" || tls == "true" {
		proxy["tls"] = true
	}
	if sni := firstNonEmpty(stringAny(data["sni"]), stringAny(data["host"])); sni != "" {
		proxy["servername"] = sni
	}
	if fp := stringAny(data["fp"]); fp != "" {
		proxy["client-fingerprint"] = fp
	}
	switch strings.ToLower(network) {
	case "ws":
		opts := map[string]any{}
		if path := stringAny(data["path"]); path != "" {
			opts["path"] = path
		}
		if host := stringAny(data["host"]); host != "" {
			opts["headers"] = map[string]any{"Host": host}
		}
		if len(opts) > 0 {
			proxy["ws-opts"] = opts
		}
	case "grpc":
		if serviceName := stringAny(data["path"]); serviceName != "" {
			proxy["grpc-opts"] = map[string]any{"grpc-service-name": serviceName}
		}
	}
	return proxy, true
}

func parseVLESSProxyLink(u *url.URL) (map[string]any, bool) {
	server := u.Hostname()
	port := parseProxyPort(u.Port(), 443)
	uuid := u.User.Username()
	if server == "" || port <= 0 || uuid == "" {
		return nil, false
	}
	q := u.Query()
	name := manualProxyName(u.Fragment, server)
	network := firstNonEmpty(q.Get("type"), q.Get("network"), "tcp")
	proxy := map[string]any{
		"name":    name,
		"type":    "vless",
		"server":  server,
		"port":    port,
		"uuid":    uuid,
		"network": network,
		"udp":     true,
	}
	if flow := q.Get("flow"); flow != "" {
		proxy["flow"] = flow
	}
	if security := strings.ToLower(q.Get("security")); security == "tls" || security == "reality" {
		proxy["tls"] = true
	}
	if sni := firstNonEmpty(q.Get("sni"), q.Get("servername")); sni != "" {
		proxy["servername"] = sni
	}
	if fp := firstNonEmpty(q.Get("fp"), q.Get("fingerprint")); fp != "" {
		proxy["client-fingerprint"] = fp
	}
	if insecure := firstNonEmpty(q.Get("allowInsecure"), q.Get("skip-cert-verify")); insecure != "" {
		proxy["skip-cert-verify"] = insecure == "1" || strings.EqualFold(insecure, "true")
	}
	if strings.EqualFold(q.Get("security"), "reality") {
		reality := map[string]any{}
		if publicKey := q.Get("pbk"); publicKey != "" {
			reality["public-key"] = publicKey
		}
		if shortID := q.Get("sid"); shortID != "" {
			reality["short-id"] = shortID
		}
		if spiderX := q.Get("spx"); spiderX != "" {
			reality["spider-x"] = spiderX
		}
		if len(reality) > 0 {
			proxy["reality-opts"] = reality
		}
	}
	applyTransportOptions(proxy, network, q)
	return proxy, true
}

func parseTrojanProxyLink(u *url.URL) (map[string]any, bool) {
	server := u.Hostname()
	port := parseProxyPort(u.Port(), 443)
	password := u.User.Username()
	if server == "" || port <= 0 || password == "" {
		return nil, false
	}
	q := u.Query()
	network := firstNonEmpty(q.Get("type"), q.Get("network"), "tcp")
	proxy := map[string]any{
		"name":     manualProxyName(u.Fragment, server),
		"type":     "trojan",
		"server":   server,
		"port":     port,
		"password": password,
		"network":  network,
		"udp":      true,
	}
	if sni := firstNonEmpty(q.Get("sni"), q.Get("servername")); sni != "" {
		proxy["sni"] = sni
	}
	if insecure := firstNonEmpty(q.Get("allowInsecure"), q.Get("skip-cert-verify")); insecure != "" {
		proxy["skip-cert-verify"] = insecure == "1" || strings.EqualFold(insecure, "true")
	}
	applyTransportOptions(proxy, network, q)
	return proxy, true
}

func parseHysteriaProxyLink(u *url.URL, proxyType string) (map[string]any, bool) {
	server := u.Hostname()
	port := parseProxyPort(u.Port(), 443)
	password := u.User.Username()
	if server == "" || port <= 0 || password == "" {
		return nil, false
	}
	q := u.Query()
	proxy := map[string]any{
		"name":     manualProxyName(u.Fragment, server),
		"type":     proxyType,
		"server":   server,
		"port":     port,
		"password": password,
		"udp":      true,
	}
	if proxyType == "hysteria" {
		proxy["auth-str"] = password
		delete(proxy, "password")
	}
	if sni := firstNonEmpty(q.Get("sni"), q.Get("peer")); sni != "" {
		proxy["sni"] = sni
	}
	if insecure := firstNonEmpty(q.Get("insecure"), q.Get("allowInsecure"), q.Get("skip-cert-verify")); insecure != "" {
		proxy["skip-cert-verify"] = insecure == "1" || strings.EqualFold(insecure, "true")
	}
	if obfs := q.Get("obfs"); obfs != "" {
		proxy["obfs"] = obfs
	}
	if obfsPassword := firstNonEmpty(q.Get("obfs-password"), q.Get("obfs_password"), q.Get("obfsParam")); obfsPassword != "" {
		proxy["obfs-password"] = obfsPassword
	}
	if alpn := q.Get("alpn"); alpn != "" {
		proxy["alpn"] = strings.Split(alpn, ",")
	}
	return proxy, true
}

func parseTUICProxyLink(u *url.URL) (map[string]any, bool) {
	server := u.Hostname()
	port := parseProxyPort(u.Port(), 443)
	uuid := u.User.Username()
	password, _ := u.User.Password()
	if server == "" || port <= 0 || uuid == "" || password == "" {
		return nil, false
	}
	q := u.Query()
	proxy := map[string]any{
		"name":                  manualProxyName(u.Fragment, server),
		"type":                  "tuic",
		"server":                server,
		"port":                  port,
		"uuid":                  uuid,
		"password":              password,
		"congestion-controller": firstNonEmpty(q.Get("congestion_control"), q.Get("congestion-controller"), "bbr"),
		"udp-relay-mode":        firstNonEmpty(q.Get("udp_relay_mode"), q.Get("udp-relay-mode"), "native"),
		"udp":                   true,
	}
	if sni := q.Get("sni"); sni != "" {
		proxy["sni"] = sni
	}
	if insecure := firstNonEmpty(q.Get("allowInsecure"), q.Get("skip-cert-verify")); insecure != "" {
		proxy["skip-cert-verify"] = insecure == "1" || strings.EqualFold(insecure, "true")
	}
	if alpn := q.Get("alpn"); alpn != "" {
		proxy["alpn"] = strings.Split(alpn, ",")
	}
	return proxy, true
}

func applyTransportOptions(proxy map[string]any, network string, q url.Values) {
	switch strings.ToLower(network) {
	case "ws":
		opts := map[string]any{}
		if path := q.Get("path"); path != "" {
			opts["path"] = path
		}
		if host := q.Get("host"); host != "" {
			opts["headers"] = map[string]any{"Host": host}
		}
		if len(opts) > 0 {
			proxy["ws-opts"] = opts
		}
	case "grpc":
		if serviceName := firstNonEmpty(q.Get("serviceName"), q.Get("service_name")); serviceName != "" {
			proxy["grpc-opts"] = map[string]any{"grpc-service-name": serviceName}
		}
	}
}

func decodeProxyBase64(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	if decoded, err := url.QueryUnescape(raw); err == nil {
		raw = decoded
	}
	raw = strings.TrimRight(raw, "\n\r")
	encodings := []*base64.Encoding{
		base64.RawURLEncoding,
		base64.URLEncoding,
		base64.RawStdEncoding,
		base64.StdEncoding,
	}
	for _, encoding := range encodings {
		if b, err := encoding.DecodeString(raw); err == nil {
			return string(b), true
		}
	}
	padded := raw
	if remainder := len(padded) % 4; remainder != 0 {
		padded += strings.Repeat("=", 4-remainder)
	}
	for _, encoding := range []*base64.Encoding{base64.URLEncoding, base64.StdEncoding} {
		if b, err := encoding.DecodeString(padded); err == nil {
			return string(b), true
		}
	}
	return "", false
}

func splitProxyHostPort(raw string, fallbackPort int) (string, int) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", 0
	}
	if host, port, err := net.SplitHostPort(raw); err == nil {
		return strings.Trim(host, "[]"), parseProxyPort(port, fallbackPort)
	}
	if colon := strings.LastIndex(raw, ":"); colon > 0 {
		return strings.Trim(raw[:colon], "[]"), parseProxyPort(raw[colon+1:], fallbackPort)
	}
	return strings.Trim(raw, "[]"), fallbackPort
}

func parseProxyPort(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	port, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return port
}

func stringAny(value any) string {
	if value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case json.Number:
		return v.String()
	case float64:
		return strconv.Itoa(int(v))
	case int:
		return strconv.Itoa(v)
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func intStringAny(value any, fallback int) int {
	switch v := value.(type) {
	case string:
		return parseProxyPort(v, fallback)
	case json.Number:
		if i, err := strconv.Atoi(v.String()); err == nil {
			return i
		}
	case float64:
		return int(v)
	case int:
		return v
	}
	return fallback
}

func manualProxyName(fragment, fallback string) string {
	if fragment != "" {
		if decoded, err := url.QueryUnescape(fragment); err == nil && strings.TrimSpace(decoded) != "" {
			return strings.TrimSpace(decoded)
		}
		return strings.TrimSpace(fragment)
	}
	return fallback
}

func indentYAML(input string, spaces int) string {
	prefix := strings.Repeat(" ", spaces)
	lines := strings.Split(strings.TrimRight(input, "\n"), "\n")
	for i, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n") + "\n"
}

func safeFilename(s string) string {
	repl := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_", " ", "_")
	return repl.Replace(s)
}
