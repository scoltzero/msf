package server

import (
	"strings"
	"testing"
)

// 国内 UDP 直连（nft china_udp_* 集合）：默认开启渲染集合与两条链的放行
// 规则；设置关闭时集合与引用一并移除（残留引用会让 nft -f 原子失败）；
// IPv6 关闭时 v6 集合同样整体移除。
func TestRenderNFTChinaUDPBypassToggle(t *testing.T) {
	app := newTestApp(t)
	app.ensureChinaUDPBypassCache()

	cfg := SetupConfig{EnableIPv6: false}
	content := app.renderNFT(cfg)
	if !strings.Contains(content, "set china_udp_ipv4") {
		t.Fatal("china_udp_ipv4 set missing with default toggle")
	}
	if !strings.Contains(content, "ip daddr @china_udp_ipv4 meta l4proto udp return") {
		t.Fatal("china_udp_ipv4 bypass rules missing in chains")
	}
	if got := strings.Count(content, "@china_udp_ipv4 meta l4proto udp return"); got != 2 {
		t.Fatalf("expected bypass rule in both chains, got %d", got)
	}
	if !strings.Contains(content, "1.0.1.0/24") {
		t.Fatal("embedded chnroute data not rendered")
	}
	if strings.Contains(content, "china_udp_ipv6") {
		t.Fatal("v6 set must be stripped when IPv6 is disabled")
	}

	app.setCachedChinaUDPBypass("false")
	content = app.renderNFT(cfg)
	if strings.Contains(content, "china_udp_ipv4") {
		t.Fatal("disabled toggle must remove set and references entirely")
	}
	app.setCachedChinaUDPBypass("")
}

func TestRenderNFTChinaUDPIncludesV6WhenEnabled(t *testing.T) {
	app := newTestApp(t)
	app.ensureChinaUDPBypassCache()
	content := app.renderNFT(SetupConfig{EnableIPv6: true})
	if !strings.Contains(content, "set china_udp_ipv6") {
		t.Fatal("china_udp_ipv6 set missing with IPv6 enabled")
	}
	if !strings.Contains(content, "2001:250::/30") {
		t.Fatal("embedded chnroute v6 data not rendered")
	}
	if got := strings.Count(content, "@china_udp_ipv6 meta l4proto udp return"); got != 2 {
		t.Fatalf("expected v6 bypass rule in both chains, got %d", got)
	}
}
