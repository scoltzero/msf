package server

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	scdomain "github.com/sagernet/sing/common/domain"
	"github.com/sagernet/sing/common/varbin"
)

func TestValidateMosDNSRuleSourceArtifact(t *testing.T) {
	dir := t.TempDir()
	validSRS := filepath.Join(dir, "valid.srs")
	var payload bytes.Buffer
	payload.WriteString("SRS")
	payload.WriteByte(3)
	zw := zlib.NewWriter(&payload)
	_, _ = zw.Write([]byte{0})
	_ = zw.Close()
	if err := os.WriteFile(validSRS, payload.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateMosDNSRuleSourceArtifact(validSRS, "srs"); err != nil {
		t.Fatalf("valid SRS rejected: %v", err)
	}
	validRoutingText := filepath.Join(dir, "routing.srs")
	if err := os.WriteFile(validRoutingText, []byte("full:example.com\ndomain:example.net\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateMosDNSRuleSourceArtifact(validRoutingText, "srs"); err != nil {
		t.Fatalf("valid routing text with SRS extension rejected: %v", err)
	}
	converted, err := os.ReadFile(validRoutingText)
	if err != nil || !bytes.HasPrefix(converted, []byte("SRS\x03")) {
		t.Fatalf("routing text was not compiled to SRS: prefix=%q err=%v", converted[:min(len(converted), 4)], err)
	}
	validIPText := filepath.Join(dir, "routing-ip.txt")
	if err := os.WriteFile(validIPText, []byte("192.0.2.0/24\n2001:db8::/32\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateMosDNSRuleSourceArtifact(validIPText, "srs", "geoipcn"); err == nil || !strings.Contains(err.Error(), "请使用 SRS 格式") {
		t.Fatalf("IP routing text should require an SRS source, err=%v", err)
	}
	validSRSWithTextExtension := filepath.Join(dir, "routing.txt")
	if err := os.WriteFile(validSRSWithTextExtension, payload.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateMosDNSRuleSourceArtifact(validSRSWithTextExtension, "srs"); err != nil {
		t.Fatalf("valid SRS with text extension rejected: %v", err)
	}
	invalidSRS := filepath.Join(dir, "invalid.srs")
	if err := os.WriteFile(invalidSRS, []byte("not srs"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateMosDNSRuleSourceArtifact(invalidSRS, "srs"); err == nil {
		t.Fatal("invalid SRS should be rejected")
	}
	validAdguard := filepath.Join(dir, "adguard.txt")
	if err := os.WriteFile(validAdguard, []byte("||example.com^\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateMosDNSRuleSourceArtifact(validAdguard, "adguard"); err != nil {
		t.Fatalf("valid AdGuard text rejected: %v", err)
	}
}

func TestCompileMosDNSRoutingTextToSRSSupportsLoyalsoldierAttributes(t *testing.T) {
	text := []byte("domain:a2z.org.cn:@cn\nfull:exact.example:@!cn\nkeyword:edge\nregexp:^api\\.example$\n")
	compiled, count, err := compileMosDNSRoutingTextToSRS(text, "cuscn")
	if err != nil {
		t.Fatal(err)
	}
	if count != 4 {
		t.Fatalf("rule count=%d want 4", count)
	}
	full, suffix, keywords, regexps, err := decodeMosDNSDomainSRSForTest(compiled)
	if err != nil {
		t.Fatal(err)
	}
	if len(full) != 1 || full[0] != "exact.example" || len(suffix) != 1 || suffix[0] != "a2z.org.cn" {
		t.Fatalf("compiled domains full=%v suffix=%v", full, suffix)
	}
	if len(keywords) != 1 || keywords[0] != "edge" || len(regexps) != 1 || regexps[0] != "^api\\.example$" {
		t.Fatalf("compiled strings keywords=%v regexps=%v", keywords, regexps)
	}
}

func TestDownloadMosDNSRoutingTextStoresCompiledSRS(t *testing.T) {
	app := newTestApp(t)
	rules := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("domain:a2z.org.cn:@cn\nfull:exact.example\n"))
	}))
	defer rules.Close()
	source := mosDNSRuleSource{
		ID: "srs:cuscn:unit-text", Name: "unit-text", Type: "cuscn", SourceType: "srs",
		Files: "srs/unit-text.txt", URL: rules.URL + "/rules.txt", ConfigPath: "configs/mosdns/srs/cuscn.json",
	}
	updated, err := app.downloadMosDNSRuleSourceArtifact(source)
	if err != nil {
		t.Fatal(err)
	}
	if updated.RuleCount != 2 {
		t.Fatalf("rule count=%d want 2", updated.RuleCount)
	}
	stored, err := os.ReadFile(filepath.Join(app.DataDir, "configs/mosdns/srs/unit-text.txt"))
	if err != nil || !bytes.HasPrefix(stored, []byte("SRS\x03")) {
		t.Fatalf("stored artifact is not compiled SRS: prefix=%q err=%v", stored[:min(len(stored), 4)], err)
	}
}

func TestCompileCurrentLoyalsoldierFixtures(t *testing.T) {
	for _, name := range []string{"cn", "nocn"} {
		path := os.Getenv("MSF_LOYALSOLDIER_" + strings.ToUpper(name) + "_FIXTURE")
		if path == "" {
			continue
		}
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		compiled, count, err := compileMosDNSRoutingTextToSRS(content, "cuscn")
		if err != nil {
			t.Fatalf("compile %s fixture: %v", name, err)
		}
		if count < 1000 || validateMosDNSSRSArtifact(compiled) != nil {
			t.Fatalf("compiled %s count=%d size=%d", name, count, len(compiled))
		}
		t.Logf("compiled %s rules=%d text=%d bytes srs=%d bytes", name, count, len(content), len(compiled))
	}
}

func decodeMosDNSDomainSRSForTest(data []byte) (full, suffix, keywords, regexps []string, err error) {
	if len(data) < 5 || string(data[:3]) != "SRS" {
		return nil, nil, nil, nil, os.ErrInvalid
	}
	zr, err := zlib.NewReader(bytes.NewReader(data[4:]))
	if err != nil {
		return nil, nil, nil, nil, err
	}
	defer zr.Close()
	br := bufio.NewReader(zr)
	if _, err = binary.ReadUvarint(br); err != nil {
		return
	}
	if _, err = br.ReadByte(); err != nil {
		return
	}
	for {
		var item byte
		item, err = br.ReadByte()
		if err != nil || item == 0xFF {
			if item == 0xFF {
				err = nil
			}
			return
		}
		switch item {
		case 2:
			var matcher *scdomain.Matcher
			matcher, err = scdomain.ReadMatcher(br)
			if err == nil {
				full, suffix = matcher.Dump()
			}
		case 3:
			keywords, err = varbin.ReadValue[[]string](br, binary.BigEndian)
		case 4:
			regexps, err = varbin.ReadValue[[]string](br, binary.BigEndian)
		default:
			err = os.ErrInvalid
		}
		if err != nil {
			return
		}
	}
}

func TestMosDNSRuleSourcesUseLocalArtifactModificationTime(t *testing.T) {
	app := newTestApp(t)
	configDir := filepath.Join(app.DataDir, "configs", "mosdns", "srs")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatal(err)
	}
	artifact := filepath.Join(configDir, "unit.srs")
	if err := os.WriteFile(artifact, []byte("binary-rule-data"), 0o644); err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, time.August, 10, 9, 8, 7, 0, time.UTC)
	if err := os.Chtimes(artifact, want, want); err != nil {
		t.Fatal(err)
	}
	config := `[
  {
    "name": "unit",
    "type": "cuscn",
    "files": "srs/unit.srs",
    "url": "https://example.invalid/unit.srs",
    "enabled": true,
    "last_updated": "2025-12-19T16:32:42+08:00"
  }
]`
	if err := os.WriteFile(filepath.Join(configDir, "cuscn.json"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}

	sources := app.mosDNSRuleSources()
	for _, source := range sources {
		if source.Name != "unit" {
			continue
		}
		got, err := time.Parse(time.RFC3339Nano, source.LastUpdated)
		if err != nil {
			t.Fatalf("parse last_updated %q: %v", source.LastUpdated, err)
		}
		if !got.Equal(want) {
			t.Fatalf("last_updated=%s want artifact mtime %s", got, want)
		}
		return
	}
	t.Fatal("unit rule source not found")
}

func TestCurrentBuiltInMosDNSRuleSourceURLRepairsRemovedGeositePrefix(t *testing.T) {
	cases := map[string]string{
		"https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/geosite-geolocation-!cn%40cn.srs": "https://raw.githubusercontent.com/Loyalsoldier/domain-list-custom/release/geolocation-cn.txt",
		"https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/geolocation-!cn%40cn.srs":         "https://raw.githubusercontent.com/Loyalsoldier/domain-list-custom/release/geolocation-cn.txt",
		"https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/geosite-cn%40!cn.srs":             "https://raw.githubusercontent.com/Loyalsoldier/domain-list-custom/release/geolocation-!cn.txt",
		"https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/cn%40!cn.srs":                     "https://raw.githubusercontent.com/Loyalsoldier/domain-list-custom/release/geolocation-!cn.txt",
		"https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/geosite-tiktok.srs":               "https://raw.githubusercontent.com/nekolsd/sing-geosite/refs/heads/rule-set/tiktok.srs",
	}
	for legacy, want := range cases {
		if got := currentBuiltInMosDNSRuleSourceURL(legacy); got != want {
			t.Fatalf("url=%q want %q", got, want)
		}
	}
}
