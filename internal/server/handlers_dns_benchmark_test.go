package server

import (
	"encoding/binary"
	"testing"
	"time"
)

func TestBuildDNSAQueryWireFormat(t *testing.T) {
	query := buildDNSAQuery(0x1234, "www.qq.com")
	if len(query) < 17 {
		t.Fatalf("query too short: %d", len(query))
	}
	if id := binary.BigEndian.Uint16(query[0:2]); id != 0x1234 {
		t.Fatalf("transaction id = %#x, want 0x1234", id)
	}
	if query[2]&0x01 == 0 {
		t.Fatal("RD flag not set")
	}
	if qdcount := binary.BigEndian.Uint16(query[4:6]); qdcount != 1 {
		t.Fatalf("QDCOUNT = %d, want 1", qdcount)
	}
	// www.qq.com -> 3www2qq3com0
	want := []byte{3, 'w', 'w', 'w', 2, 'q', 'q', 3, 'c', 'o', 'm', 0}
	got := query[12 : 12+len(want)]
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("qname octet %d = %d, want %d", i, got[i], want[i])
		}
	}
	rest := query[12+len(want):]
	if len(rest) != 4 {
		t.Fatalf("trailing bytes = %d, want 4 (QTYPE+QCLASS)", len(rest))
	}
	if qtype := binary.BigEndian.Uint16(rest[0:2]); qtype != 1 {
		t.Fatalf("QTYPE = %d, want 1 (A)", qtype)
	}
	if qclass := binary.BigEndian.Uint16(rest[2:4]); qclass != 1 {
		t.Fatalf("QCLASS = %d, want 1 (IN)", qclass)
	}
}

func TestValidateDNSResponse(t *testing.T) {
	query := buildDNSAQuery(0xabcd, "www.qq.com")
	if err := validateDNSResponse(query, 0xabcd, false, true); err == nil {
		t.Fatal("request accepted as response")
	}
	resp := make([]byte, len(query))
	copy(resp, query)
	resp[2] |= 0x80
	binary.BigEndian.PutUint16(resp[6:8], 1)
	if err := validateDNSResponse(resp, 0xabcd, false, true); err != nil {
		t.Fatalf("valid response rejected: %v", err)
	}
	if err := validateDNSResponse(resp, 0x1111, false, true); err == nil {
		t.Fatal("mismatched id accepted")
	}
	if err := validateDNSResponse(resp[:8], 0xabcd, false, true); err == nil {
		t.Fatal("short message accepted")
	}
	servfail := append([]byte(nil), resp...)
	servfail[3] = (servfail[3] & 0xf0) | 2
	if err := validateDNSResponse(servfail, 0xabcd, true, false); err == nil {
		t.Fatal("SERVFAIL response accepted as a usable upstream")
	}
	nxdomain := append([]byte(nil), resp...)
	nxdomain[3] = (nxdomain[3] & 0xf0) | 3
	if err := validateDNSResponse(nxdomain, 0xabcd, true, false); err != nil {
		t.Fatalf("NXDOMAIN probe response rejected: %v", err)
	}
	if err := validateDNSResponse(nxdomain, 0xabcd, false, true); err == nil {
		t.Fatal("NXDOMAIN accepted for a known-existing probe domain")
	}
}

func TestDNSBenchmarkRateGateAndSetupVisibility(t *testing.T) {
	app := newTestApp(t)
	if !app.publicAPI("/api/v1/system/dns-benchmark") {
		t.Fatal("DNS benchmark must remain public before setup creates an account")
	}
	finish, _, ok := app.beginDNSBenchmark(time.Now())
	if !ok || finish == nil {
		t.Fatal("first DNS benchmark was rejected")
	}
	if _, _, ok := app.beginDNSBenchmark(time.Now()); ok {
		t.Fatal("concurrent DNS benchmark was accepted")
	}
	finish()
	if _, _, ok := app.beginDNSBenchmark(time.Now()); ok {
		t.Fatal("DNS benchmark cooldown was not enforced")
	}
	insertSetupRow(t, app, "meta", false, "")
	if app.publicAPI("/api/v1/system/dns-benchmark") {
		t.Fatal("DNS benchmark remained unauthenticated after initialization")
	}
}

func TestSelectRecommendedUpstreamsDedupesVendor(t *testing.T) {
	results := []dnsBenchmarkResult{
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "ali", Addr: "223.5.5.5:53"}, OK: true, AvgMs: 11},
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "ali", Addr: "223.6.6.6:53"}, OK: true, AvgMs: 12},
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "tencent", Addr: "119.29.29.29:53"}, OK: true, AvgMs: 13},
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "onedns", Addr: "117.50.10.10:53"}, OK: false, AvgMs: 5},
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "baidu", Addr: "180.76.76.76:53"}, OK: true, AvgMs: 14},
	}
	got := selectRecommendedUpstreams(results)
	if len(got) != 3 {
		t.Fatalf("recommended %d upstreams, want 3", len(got))
	}
	wantVendors := []string{"ali", "tencent", "baidu"}
	for i, vendor := range wantVendors {
		if got[i].Vendor != vendor {
			t.Fatalf("recommended[%d].Vendor = %s, want %s", i, got[i].Vendor, vendor)
		}
	}
	if len(selectRecommendedUpstreams(nil)) != 0 {
		t.Fatal("empty input should produce empty recommendation")
	}
	partial := []dnsBenchmarkResult{
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "ali", Addr: "223.5.5.5:53"}, OK: true, AvgMs: 20},
	}
	if got := selectRecommendedUpstreams(partial); len(got) != 1 {
		t.Fatalf("single usable candidate should yield 1, got %d", len(got))
	}
}

// 组合规则：两条最快 UDP + 一条 DoH 兜底——即使低延迟网关排在 DoH 前面，
// 推荐也必须保留加密形态，且同一供应商不重复。
func TestSelectRecommendedUpstreamsKeepsDoHFallback(t *testing.T) {
	results := []dnsBenchmarkResult{
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "volc", Protocol: "udp", Addr: "180.184.1.1:53"}, OK: true, AvgMs: 7},
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "tencent", Protocol: "udp", Addr: "119.29.29.29:53"}, OK: true, AvgMs: 12},
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "gateway", Protocol: "gateway", Addr: "192.168.1.1:53"}, OK: true, AvgMs: 15},
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "ali", Protocol: "doh", Addr: "https://223.5.5.5/dns-query"}, OK: true, AvgMs: 28},
		{dnsBenchmarkCandidate: dnsBenchmarkCandidate{Vendor: "baidu", Protocol: "udp", Addr: "180.76.76.76:53"}, OK: true, AvgMs: 20},
	}
	got := selectRecommendedUpstreams(results)
	if len(got) != 3 {
		t.Fatalf("recommended %d, want 3: %+v", len(got), got)
	}
	if got[0].Addr != "180.184.1.1:53" || got[1].Addr != "119.29.29.29:53" {
		t.Fatalf("two fastest UDP should lead: %+v", got)
	}
	if got[2].Protocol != "doh" {
		t.Fatalf("third slot must keep the DoH fallback, got %+v", got[2])
	}
}

func TestNormalizeMosDNSUpstreamGroupsForwardMigration(t *testing.T) {
	t.Run("bare udp addr gains scheme prefix", func(t *testing.T) {
		raw := map[string]any{
			"domestic": []any{
				map[string]any{"tag": "阿里UDP", "enabled": true, "protocol": "udp", "addr": "223.5.5.5"},
				map[string]any{"tag": "腾讯TCP", "enabled": true, "protocol": "tcp", "addr": "119.29.29.29"},
			},
		}
		groups, err := normalizeMosDNSUpstreamGroups(raw)
		if err != nil {
			t.Fatalf("normalize failed: %v", err)
		}
		if addr := groups["domestic"][0]["addr"]; addr != "udp://223.5.5.5" {
			t.Fatalf("udp addr = %v, want udp://223.5.5.5", addr)
		}
		if addr := groups["domestic"][1]["addr"]; addr != "tcp://119.29.29.29" {
			t.Fatalf("tcp addr = %v, want tcp://119.29.29.29", addr)
		}
	})
	t.Run("schemed addr untouched", func(t *testing.T) {
		raw := map[string]any{
			"domestic": []any{
				map[string]any{"tag": "OneDNS", "enabled": true, "protocol": "https", "addr": "https://117.50.10.10/dns-query"},
			},
		}
		groups, err := normalizeMosDNSUpstreamGroups(raw)
		if err != nil {
			t.Fatalf("normalize failed: %v", err)
		}
		if addr := groups["domestic"][0]["addr"]; addr != "https://117.50.10.10/dns-query" {
			t.Fatalf("https addr rewritten: %v", addr)
		}
	})
	t.Run("enabled aliapi entries dropped silently alongside usable ones", func(t *testing.T) {
		raw := map[string]any{
			"domestic": []any{
				map[string]any{"tag": "阿里私享DOH", "enabled": true, "protocol": "aliapi", "server_addr": "223.5.5.5"},
				map[string]any{"tag": "阿里UDP", "enabled": true, "protocol": "udp", "addr": "223.5.5.5"},
			},
		}
		groups, err := normalizeMosDNSUpstreamGroups(raw)
		if err != nil {
			t.Fatalf("normalize failed: %v", err)
		}
		if len(groups["domestic"]) != 1 {
			t.Fatalf("aliapi entry not dropped: %v", groups["domestic"])
		}
	})
	t.Run("aliapi-only group fails with explicit message", func(t *testing.T) {
		raw := map[string]any{
			"domestic": []any{
				map[string]any{"tag": "阿里私享DOH", "enabled": true, "protocol": "aliapi", "server_addr": "223.5.5.5"},
			},
		}
		if _, err := normalizeMosDNSUpstreamGroups(raw); err == nil {
			t.Fatal("aliapi-only group should fail")
		}
	})
	t.Run("missing address fails", func(t *testing.T) {
		raw := map[string]any{
			"domestic": []any{
				map[string]any{"tag": "无地址", "enabled": true, "protocol": "udp"},
			},
		}
		if _, err := normalizeMosDNSUpstreamGroups(raw); err == nil {
			t.Fatal("entry without address should fail")
		}
	})
}
