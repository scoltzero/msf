package server

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	// A day is long enough to keep the normal stale-cache optimization useful,
	// while preventing a persisted bad answer from surviving for years.
	mosDNSLazyCacheTTLSeconds = 86400
	mosDNSCacheAllTag         = "cache_all"
	mosDNSCacheAllNoLeakTag   = "cache_all_noleak"
	mosDNSFakeIPLearningTag   = "my_fakeiplist"
)

var mosDNSFakeIPLearningFiles = []string{
	"configs/mosdns/gen/fakeiprule.txt",
	"configs/mosdns/gen/fakeiplist.txt",
}

type mosDNSCacheTemplatePlugin struct {
	Tag  string `yaml:"tag"`
	Args struct {
		LazyCacheTTL int `yaml:"lazy_cache_ttl"`
		ExcludeIPs   any `yaml:"exclude_ip"`
	} `yaml:"args"`
}

type mosDNSCacheTemplateDocument struct {
	Plugins []mosDNSCacheTemplatePlugin `yaml:"plugins"`
}

// renderMosDNSCacheTemplate keeps the Fake-IP exclusion list in sync with the
// configured ranges.  The embedded template is the source of truth for the
// plugin layout and default TTL; only the ranges are runtime-specific.
func renderMosDNSCacheTemplate(cfg SetupConfig) (string, error) {
	template, ok := runtimeTemplateText("mosdns/sub_config/cache.yaml")
	if !ok {
		return "", fmt.Errorf("missing embedded MosDNS template mosdns/sub_config/cache.yaml")
	}
	cfg.defaults()
	template = strings.ReplaceAll(template, defaultFakeIPv4Prefix, fakeIPv4RouteCIDR(cfg.FakeIPRangeV4))
	template = strings.ReplaceAll(template, defaultFakeIPv6Prefix, fakeIPv6RouteCIDR(cfg.FakeIPRangeV6))
	var parsed mosDNSCacheTemplateDocument
	if err := yaml.Unmarshal([]byte(template), &parsed); err != nil {
		return "", fmt.Errorf("validate MosDNS cache template: %w", err)
	}
	return template, nil
}

func mosDNSCacheTemplateNeedsRepair(content string, cfg SetupConfig) bool {
	var parsed mosDNSCacheTemplateDocument
	if err := yaml.Unmarshal([]byte(content), &parsed); err != nil {
		// Do not overwrite an operator-supplied file that is not parseable here;
		// the normal MosDNS validation path will report that configuration error.
		return false
	}
	cfg.defaults()
	expectedV4 := fakeIPv4RouteCIDR(cfg.FakeIPRangeV4)
	expectedV6 := fakeIPv6RouteCIDR(cfg.FakeIPRangeV6)
	seenFrontCaches := 0
	for _, plugin := range parsed.Plugins {
		if plugin.Tag != mosDNSCacheAllTag && plugin.Tag != mosDNSCacheAllNoLeakTag {
			continue
		}
		seenFrontCaches++
		hasV4, hasV6 := false, false
		for _, excluded := range mosDNSCacheExcludedIPs(plugin.Args.ExcludeIPs) {
			excluded = strings.TrimSpace(excluded)
			hasV4 = hasV4 || excluded == expectedV4
			hasV6 = hasV6 || excluded == expectedV6
		}
		if plugin.Args.LazyCacheTTL > mosDNSLazyCacheTTLSeconds || !hasV4 || !hasV6 {
			return true
		}
	}
	return seenFrontCaches != 2
}

func mosDNSCacheExcludedIPs(value any) []string {
	switch v := value.(type) {
	case string:
		return strings.Fields(v)
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	case []string:
		return v
	default:
		return nil
	}
}

// ensureMosDNSCacheSafety upgrades the pre-0.6.5 cache template before the
// service is started.  Old front-cache dumps and learned Fake-IP rules are
// ephemeral state; dropping them is required because MosDNS restores dump
// entries before the new exclusion rule can take effect.
func (a *App) ensureMosDNSCacheSafety() error {
	path := filepath.Join(a.DataDir, "configs/mosdns/sub_config/cache.yaml")
	content, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	cfg, ok := a.latestSetupConfig()
	if !ok {
		cfg = SetupConfig{}
	}
	cfg.defaults()
	if !mosDNSCacheTemplateNeedsRepair(string(content), cfg) {
		return nil
	}
	repaired, err := renderMosDNSCacheTemplate(cfg)
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(repaired), 0644); err != nil {
		return fmt.Errorf("repair MosDNS cache template: %w", err)
	}
	if err := a.clearMosDNSFrontCacheDumpFiles(); err != nil {
		return err
	}
	return a.clearMosDNSFakeIPLearningFiles()
}

func (a *App) clearMosDNSFrontCacheDumpFiles() error {
	for _, name := range []string{"cache_all.dump", "cache_all_noleak.dump"} {
		path := filepath.Join(a.DataDir, "configs/mosdns/cache", name)
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove MosDNS cache dump %s: %w", name, err)
		}
	}
	return nil
}

func (a *App) clearMosDNSFakeIPLearningFiles() error {
	for _, rel := range mosDNSFakeIPLearningFiles {
		path, err := a.safePath(rel)
		if err != nil {
			return err
		}
		if _, err := os.Stat(path); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		if err := os.WriteFile(path, nil, 0644); err != nil {
			return fmt.Errorf("clear MosDNS Fake-IP learning file %s: %w", rel, err)
		}
	}
	return nil
}

// clearMosDNSFakeIPLearning clears both the domain_output state and its files.
// domain_output's flush endpoint also posts an empty set to my_fakeiprule, so
// the running matcher is updated in the same operation.
func (a *App) clearMosDNSFakeIPLearning() (bool, error) {
	running := a.Services != nil && a.Services.Status("mosdns").Running
	var runtimeErr error
	if running {
		runtimeErr = a.mosDNSRuntimeJSONRequest(http.MethodGet, "/plugins/"+mosDNSFakeIPLearningTag+"/flush", nil, nil)
	}
	if err := a.clearMosDNSFakeIPLearningFiles(); err != nil {
		return false, err
	}
	// A stopped MosDNS cannot flush its in-memory cache. Remove the two front
	// cache dumps as well so a subsequent start cannot restore old Fake-IP data.
	if !running {
		if err := a.clearMosDNSFrontCacheDumpFiles(); err != nil {
			return false, err
		}
	}
	if runtimeErr != nil {
		return false, runtimeErr
	}
	return true, nil
}
