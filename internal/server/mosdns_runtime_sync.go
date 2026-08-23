package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const mosDNSRuntimeSyncTimeout = 3 * time.Second

var mosDNSCachePluginTags = []string{
	"cache_all",
	"cache_all_noleak",
	"cache_cn",
	"cache_google",
	"cache_google_node",
	"cache_node",
	"cache_cnmihomo",
}

// yyysuo/mosdns domain_mapper debounces provider notifications for one second
// before rebuilding its matcher. Flushing the front caches before that rebuild
// leaves a window where a query can repopulate them with the previous decision.
var waitForMosDNSRulePropagation = func() {
	time.Sleep(1200 * time.Millisecond)
}

// Rule-source plugins rebuild asynchronously. AdGuard first applies its own
// 500ms debounce and all domain providers then notify domain_mapper, whose
// rebuild is debounced for another second.
var waitForMosDNSRuleSourcePropagation = func() {
	time.Sleep(1700 * time.Millisecond)
}

func (a *App) syncMosDNSPluginValues(tag string, values []string) error {
	if !a.Services.Status("mosdns").Running {
		return nil
	}
	payload := map[string]any{"values": values}
	if err := a.mosDNSRuntimeJSONRequest(http.MethodPost, "/plugins/"+url.PathEscape(tag)+"/post", payload, nil); err != nil {
		return fmt.Errorf("名单已保存到文件，但 MosDNS 热同步失败；请重启 MosDNS 后生效：%w", err)
	}
	if mosDNSDomainMapperBackedTag(tag) {
		waitForMosDNSRulePropagation()
	}
	if err := a.flushMosDNSFrontCaches(); err != nil {
		return fmt.Errorf("名单已热同步，但 DNS 缓存清理失败；测试前请手动清理 MosDNS 缓存：%w", err)
	}
	return nil
}

func mosDNSDomainMapperBackedTag(tag string) bool {
	switch tag {
	case "whitelist", "blocklist", "greylist", "ddnslist":
		return true
	default:
		return false
	}
}

func (a *App) flushMosDNSFrontCaches() error {
	for _, tag := range []string{"cache_all", "cache_all_noleak"} {
		if err := a.mosDNSRuntimeJSONRequest(http.MethodGet, "/plugins/"+tag+"/flush", nil, nil); err != nil {
			return fmt.Errorf("flush %s: %w", tag, err)
		}
	}
	return nil
}

func (a *App) syncMosDNSRuleSourceRuntime(source mosDNSRuleSource, create bool) (mosDNSRuleSource, error) {
	if !a.Services.Status("mosdns").Running {
		if create && source.Enabled {
			return a.downloadMosDNSRuleSourceArtifact(source)
		}
		return source, nil
	}
	if source.SourceType == "adguard" {
		method := http.MethodPut
		path := "/plugins/adguard/rules/" + url.PathEscape(source.ID)
		payload := source
		if create {
			method = http.MethodPost
			path = "/plugins/adguard/rules"
			// The upstream create API starts an asynchronous download immediately
			// for enabled sources. Create it disabled so MSF can perform and verify
			// the first download before enabling the runtime matcher.
			payload.Enabled = false
		}
		var runtimeSource mosDNSRuleSource
		if err := a.mosDNSRuntimeJSONRequest(method, path, payload, &runtimeSource); err != nil {
			return source, fmt.Errorf("规则源已保存到文件，但 MosDNS 热同步失败；请重启 MosDNS 后生效：%w", err)
		}
		if runtimeSource.ID != "" {
			runtimeSource.SourceType = "adguard"
			runtimeSource.Type = "adguard"
			runtimeSource.ConfigPath = "configs/mosdns/adguard/config.json"
			runtimeSource.hydrateRuntimeFields()
			runtimeSource.Enabled = source.Enabled
			if create && runtimeSource.ID != source.ID {
				if err := a.replaceMosDNSRuleSource(runtimeSource); err != nil {
					return source, fmt.Errorf("MosDNS 已创建运行时规则源，但本地元数据同步失败：%w", err)
				}
			}
			if create && runtimeSource.Enabled {
				var err error
				runtimeSource, err = a.downloadMosDNSRuleSourceArtifact(runtimeSource)
				if err != nil {
					return runtimeSource, fmt.Errorf("规则源配置已创建，但首次下载失败：%w", err)
				}
				path = "/plugins/adguard/rules/" + url.PathEscape(runtimeSource.ID)
				if err := a.mosDNSRuntimeJSONRequest(http.MethodPut, path, runtimeSource, nil); err != nil {
					return runtimeSource, fmt.Errorf("规则源已下载，但 MosDNS 热同步失败；请重启 MosDNS 后生效：%w", err)
				}
			}
			waitForMosDNSRuleSourcePropagation()
			if err := a.flushMosDNSFrontCaches(); err != nil {
				return runtimeSource, fmt.Errorf("规则源已热同步，但 DNS 缓存清理失败；测试前请手动清理 MosDNS 缓存：%w", err)
			}
			return runtimeSource, nil
		}
		waitForMosDNSRuleSourcePropagation()
		if err := a.flushMosDNSFrontCaches(); err != nil {
			return source, fmt.Errorf("规则源已热同步，但 DNS 缓存清理失败；测试前请手动清理 MosDNS 缓存：%w", err)
		}
		return source, nil
	}
	if create && source.Enabled {
		var err error
		source, err = a.downloadMosDNSRuleSourceArtifact(source)
		if err != nil {
			return source, fmt.Errorf("规则源配置已创建，但首次下载失败：%w", err)
		}
	}

	tag := mosDNSRuleSourcePluginTag(source.Type)
	if tag == "" {
		return source, fmt.Errorf("规则源已保存到文件，但类型 %q 不支持热同步；请重启 MosDNS 后生效", source.Type)
	}
	path := "/plugins/" + url.PathEscape(tag) + "/config/" + url.PathEscape(source.Name)
	if err := a.mosDNSRuntimeJSONRequest(http.MethodPut, path, source, nil); err != nil {
		return source, fmt.Errorf("规则源已保存到文件，但 MosDNS 热同步失败；请重启 MosDNS 后生效：%w", err)
	}
	waitForMosDNSRuleSourcePropagation()
	if err := a.flushMosDNSFrontCaches(); err != nil {
		return source, fmt.Errorf("规则源已热同步，但 DNS 缓存清理失败；测试前请手动清理 MosDNS 缓存：%w", err)
	}
	return source, nil
}

func (a *App) deleteMosDNSRuleSourceRuntime(source mosDNSRuleSource) error {
	if err := a.deleteMosDNSRuleSourceRuntimeWithoutCacheFlush(source); err != nil {
		return err
	}
	if !a.Services.Status("mosdns").Running {
		return nil
	}
	waitForMosDNSRuleSourcePropagation()
	if err := a.flushMosDNSFrontCaches(); err != nil {
		return fmt.Errorf("规则源已从 MosDNS 运行时删除，但 DNS 缓存清理失败；测试前请手动清理 MosDNS 缓存：%w", err)
	}
	return nil
}

func (a *App) deleteMosDNSRuleSourceRuntimeWithoutCacheFlush(source mosDNSRuleSource) error {
	if !a.Services.Status("mosdns").Running {
		return nil
	}
	var path string
	if source.SourceType == "adguard" {
		path = "/plugins/adguard/rules/" + url.PathEscape(source.ID)
	} else {
		tag := mosDNSRuleSourcePluginTag(source.Type)
		if tag == "" {
			return fmt.Errorf("规则源已从文件中删除，但类型 %q 不支持热同步；请重启 MosDNS 后生效", source.Type)
		}
		path = "/plugins/" + url.PathEscape(tag) + "/config/" + url.PathEscape(source.Name)
	}
	if err := a.mosDNSRuntimeJSONRequest(http.MethodDelete, path, nil, nil); err != nil {
		return fmt.Errorf("规则源已从文件中删除，但 MosDNS 热同步失败；请重启 MosDNS 后生效：%w", err)
	}
	return nil
}

func (a *App) updateMosDNSRuleSourceRuntime(previous, next mosDNSRuleSource) (mosDNSRuleSource, error) {
	if !a.Services.Status("mosdns").Running || mosDNSRuleSourceRuntimeIdentity(previous) == mosDNSRuleSourceRuntimeIdentity(next) {
		return a.syncMosDNSRuleSourceRuntime(next, false)
	}
	var preserved []byte
	var localPath string
	if previous.LocalPath != "" {
		if path, err := a.safePath(previous.LocalPath); err == nil {
			localPath = path
			preserved, _ = os.ReadFile(path)
		}
	}
	if err := a.deleteMosDNSRuleSourceRuntimeWithoutCacheFlush(previous); err != nil {
		return next, err
	}
	if len(preserved) > 0 && localPath != "" {
		if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
			return next, err
		}
		if err := os.WriteFile(localPath, preserved, 0644); err != nil {
			return next, err
		}
	}
	return a.syncMosDNSRuleSourceRuntime(next, false)
}

func mosDNSRuleSourceRuntimeIdentity(source mosDNSRuleSource) string {
	if source.SourceType == "adguard" {
		return "adguard:" + source.ID
	}
	return mosDNSRuleSourcePluginTag(source.Type) + ":" + source.Name
}

func mosDNSRuleSourcePluginTag(sourceType string) string {
	switch normalizeMosDNSGeositeType(sourceType) {
	case "geositecn":
		return "geosite_cn"
	case "geositenocn":
		return "geosite_no_cn"
	case "geoipcn":
		return "geoip_cn"
	case "cuscn":
		return "cuscn"
	case "cusnocn":
		return "cusnocn"
	default:
		return ""
	}
}

func (a *App) mosDNSRuntimeJSONRequest(method, path string, payload any, dst any) error {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, a.mosDNSAPIURL(path), body)
	if err != nil {
		return err
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := (&http.Client{Timeout: mosDNSRuntimeSyncTimeout}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return readErr
	}
	trimmed := strings.TrimSpace(string(responseBody))
	if resp.StatusCode >= http.StatusMultipleChoices {
		if trimmed != "" {
			return fmt.Errorf("http %d: %s", resp.StatusCode, trimmed)
		}
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	if strings.HasPrefix(strings.ToLower(trimmed), "invalid request") {
		return fmt.Errorf("MosDNS rejected runtime endpoint %s", path)
	}
	if dst != nil && trimmed != "" {
		if err := json.Unmarshal(responseBody, dst); err != nil {
			return fmt.Errorf("decode MosDNS response: %w", err)
		}
	}
	return nil
}
