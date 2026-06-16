package server

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type mihomoGeoDataFile struct {
	Name string
	URL  string
}

var (
	mihomoGeoDataAutoEnsure = true
	mihomoGeoDataHTTPClient = &http.Client{Timeout: 60 * time.Second}
	mihomoGeoDataFiles      = []mihomoGeoDataFile{
		{Name: "GeoSite.dat", URL: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geosite.dat"},
		{Name: "GeoIP.dat", URL: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/geoip.dat"},
	}
)

func (a *App) ensureMihomoGeoDataFiles() error {
	if !mihomoGeoDataAutoEnsure {
		return nil
	}
	dir := filepath.Join(a.DataDir, "configs/mihomo")
	if err := os.MkdirAll(dir, 0755); err != nil {
		a.logMihomoGeoDataWarning("", "", err)
		return nil
	}
	for _, item := range mihomoGeoDataFiles {
		if item.Name == "" || item.URL == "" {
			continue
		}
		dest := filepath.Join(dir, item.Name)
		if nonEmptyRegularFile(dest) {
			continue
		}
		if err := downloadMihomoGeoDataFile(context.Background(), item.URL, dest); err != nil {
			a.logMihomoGeoDataWarning(item.Name, item.URL, err)
		}
	}
	return nil
}

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
	if updated == original {
		return
	}
	if err := os.WriteFile(path, []byte(updated), 0644); err != nil {
		a.logMihomoGeoDataWarning("config.yaml", "", err)
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

func nonEmptyRegularFile(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir() && st.Size() > 0
}

func downloadMihomoGeoDataFile(ctx context.Context, rawURL, dest string) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	resp, err := mihomoGeoDataHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download %s: HTTP %d", rawURL, resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dest), "."+filepath.Base(dest)+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	written, copyErr := io.Copy(tmp, resp.Body)
	closeErr := tmp.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written == 0 {
		return fmt.Errorf("download %s: empty response", rawURL)
	}
	if err := os.Chmod(tmpName, 0644); err != nil {
		return err
	}
	return os.Rename(tmpName, dest)
}

func (a *App) logMihomoGeoDataWarning(name, rawURL string, err error) {
	if err == nil {
		return
	}
	a.LogWarn("mihomo_geodata", "Mihomo GeoData 文件准备失败", map[string]any{
		"file":  name,
		"url":   rawURL,
		"error": err.Error(),
	})
}
