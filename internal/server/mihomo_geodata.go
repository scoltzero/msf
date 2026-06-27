package server

import (
	"os"
	"path/filepath"
	"strings"
)

func (a *App) ensureGeneratedMihomoConfigCompatibility() {
	path := filepath.Join(a.DataDir, "configs/mihomo/config.yaml")
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	original := string(b)
	updated := removeTopLevelYAMLKey(original, "global-client-fingerprint")
	replacements := map[string]string{
		"https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geoip.dat":   "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat",
		"https://github.com/MetaCubeX/meta-rules-dat/releases/latest/download/geosite.dat": "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat",
		"https://gitlab.com/Masaiki/GeoIP2-CN/-/raw/release/Country.mmdb":                  "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.metadb",
		"https://gitlab.com/Loon0x00/loon_data/-/raw/main/geo/GeoLite2-ASN.mmdb":           "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb",
	}
	for old, next := range replacements {
		updated = strings.ReplaceAll(updated, old, next)
	}
	if a.DB != nil {
		if cfg, ok := a.latestSetupConfig(); ok {
			cfg.defaults()
			if isTUNProxyMode(cfg.LinuxProxyMode) {
				_ = os.Remove(filepath.Join(a.DataDir, "configs/network/network.nft"))
				if a.mihomoConfigMode() != "custom" {
					updated = removeTopLevelYAMLKeys(updated, map[string]bool{
						"redir-port":   true,
						"tproxy-port":  true,
						"routing-mark": true,
					})
					updated = replaceTopLevelYAMLBlock(updated, "tun", renderMihomoTunYAML(cfg))
					updated = ensureMihomoProxyServerNameserver(updated, cfg)
				}
			}
		}
	}
	if updated == original {
		return
	}
	if err := os.WriteFile(path, []byte(updated), 0644); err != nil {
		a.LogWarn("mihomo_geodata", "Mihomo GeoData 配置兼容修正失败", map[string]any{
			"file":  "config.yaml",
			"error": err.Error(),
		})
	}
}

func removeTopLevelYAMLKey(content, key string) string {
	prefix := key + ":"
	lines := strings.SplitAfter(content, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmedLeft := strings.TrimLeft(line, " \t")
		if len(trimmedLeft) == len(line) && strings.HasPrefix(trimmedLeft, prefix) {
			continue
		}
		out = append(out, line)
	}
	return strings.Join(out, "")
}
