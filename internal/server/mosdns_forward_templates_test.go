package server

import (
	"strings"
	"testing"
)

// forward 迁移后的渲染产物契约：四个上游插件全部为 forward 类型，
// 默认池可被 overrides 替换，且产物保持合法 YAML（替换器内部已校验）。
func TestRenderMosDNSManagedFilesForwardTemplates(t *testing.T) {
	app := newTestApp(t)
	// 测试夹具可能携带 fallback overrides 文件；显式存入空覆盖，
	// 让渲染落在纯模板默认池上。
	app.storeJSONSetting("mosdns_upstream_overrides", map[string]any{})
	files, err := app.renderMosDNSManagedFiles(SetupConfig{})
	if err != nil {
		t.Fatalf("render failed: %v", err)
	}
	for _, rel := range []string{
		"configs/mosdns/sub_config/forward_local.yaml",
		"configs/mosdns/sub_config/forward_nocn.yaml",
		"configs/mosdns/sub_config/forward_nocn_ecs.yaml",
		"configs/mosdns/sub_config/forward_1.yaml",
	} {
		content, ok := files[rel]
		if !ok {
			t.Fatalf("missing rendered file %s", rel)
		}
		if strings.Contains(content, "type: aliapi") {
			t.Fatalf("%s still uses aliapi plugin", rel)
		}
		if !strings.Contains(content, "type: forward") {
			t.Fatalf("%s does not use forward plugin", rel)
		}
	}

	local := files["configs/mosdns/sub_config/forward_local.yaml"]
	for _, want := range []string{"udp://223.5.5.5", "udp://119.29.29.29", "https://223.5.5.5/dns-query", "concurrent: 3"} {
		if !strings.Contains(local, want) {
			t.Fatalf("forward_local.yaml missing default pool entry %q:\n%s", want, local)
		}
	}

	nocn := files["configs/mosdns/sub_config/forward_nocn.yaml"]
	if !strings.Contains(nocn, "https://1.1.1.1/dns-query") || !strings.Contains(nocn, "https://8.8.8.8/dns-query") {
		t.Fatalf("forward_nocn.yaml missing default foreign upstreams:\n%s", nocn)
	}
}

func TestRenderMosDNSManagedFilesOverridesReplaceForwardUpstreams(t *testing.T) {
	app := newTestApp(t)
	app.storeJSONSetting("mosdns_upstream_overrides", map[string]any{
		"domestic": []any{
			map[string]any{"tag": "OneDNS", "enabled": true, "protocol": "https", "addr": "https://117.50.10.10/dns-query"},
			map[string]any{"tag": "网关", "enabled": true, "protocol": "udp", "addr": "192.168.1.1"},
		},
	})
	files, err := app.renderMosDNSManagedFiles(SetupConfig{})
	if err != nil {
		t.Fatalf("render failed: %v", err)
	}
	local := files["configs/mosdns/sub_config/forward_local.yaml"]
	if !strings.Contains(local, "https://117.50.10.10/dns-query") {
		t.Fatalf("override upstream missing in rendered file:\n%s", local)
	}
	// 裸 IP UDP 候选在渲染产物里必须带 scheme 前缀，forward 才能解析。
	if !strings.Contains(local, "udp://192.168.1.1") {
		t.Fatalf("bare udp addr was not prefixed:\n%s", local)
	}
	if strings.Contains(local, "udp://223.5.5.5") {
		t.Fatalf("default pool entry should be replaced by overrides:\n%s", local)
	}
}

func TestMosDNSLocalSuffixRejectionUsesDomainMatcher(t *testing.T) {
	content, ok := runtimeTemplateText("mosdns/config.yaml")
	if !ok {
		t.Fatal("missing MosDNS config template")
	}
	for _, matcher := range []string{"qname domain:lan", "qname domain:local"} {
		if got := strings.Count(content, matcher); got != 2 {
			t.Fatalf("matcher %q appears %d times, want 2", matcher, got)
		}
	}
	for _, unsafe := range []string{"qname keyword:.lan", "qname keyword:.local"} {
		if strings.Contains(content, unsafe) {
			t.Fatalf("substring matcher %q can reject public domains such as example.land", unsafe)
		}
	}
}
