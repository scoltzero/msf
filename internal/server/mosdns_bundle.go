package server

import (
	"archive/zip"
	"context"
	"debug/elf"
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

const (
	mosDNSBundleMaxSize         = 256 << 20
	mosDNSBundleMaxExpandedSize = 512 << 20
	mosDNSConfigPath            = "configs/mosdns/config_custom.yaml"
)

type mosDNSBundleLayout struct {
	MosDNSBinary string
	MosDNSRoot   string
	TrafficAgent string
	TrafficRoot  string
}

func (a *App) hasMosDNSBundle() bool {
	for _, required := range []string{
		filepath.Join(a.DataDir, "data", "binaries", "mosdns", "mosdns"),
		filepath.Join(a.DataDir, "data", "binaries", "mosdns-traffic-agent", "mosdns-traffic-agent"),
		filepath.Join(a.DataDir, mosDNSConfigPath),
		filepath.Join(a.DataDir, "configs", "monitor", "config.json"),
	} {
		info, err := os.Stat(required)
		if err != nil || info.IsDir() {
			return false
		}
	}
	return true
}

func (a *App) installMosDNSBundle(ctx context.Context, archive, iface string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	uploads := filepath.Join(a.DataDir, "data", "uploads")
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		return err
	}
	extracted, err := os.MkdirTemp(uploads, "mosdns-bundle-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(extracted)
	if err := validateMosDNSBundleArchive(archive); err != nil {
		return err
	}
	if err := extractZipPreserve(archive, extracted); err != nil {
		return fmt.Errorf("extract MosDNS ZIP: %w", err)
	}
	layout, err := findMosDNSBundleLayout(extracted)
	if err != nil {
		return err
	}
	if err := validateLinuxAMD64ELF(layout.MosDNSBinary); err != nil {
		return fmt.Errorf("invalid MosDNS binary: %w", err)
	}
	if err := validateLinuxAMD64ELF(layout.TrafficAgent); err != nil {
		return fmt.Errorf("invalid mosdns-traffic-agent binary: %w", err)
	}

	staging, err := os.MkdirTemp(a.DataDir, ".mosdns-bundle-staging-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	mosdnsBin := filepath.Join(staging, "mosdns-bin")
	trafficBin := filepath.Join(staging, "traffic-bin")
	mosdnsConfig := filepath.Join(staging, "mosdns-config")
	trafficConfig := filepath.Join(staging, "traffic-config")
	if err := os.MkdirAll(mosdnsBin, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(trafficBin, 0o755); err != nil {
		return err
	}
	if err := copyFile(layout.MosDNSBinary, filepath.Join(mosdnsBin, "mosdns"), 0o755); err != nil {
		return err
	}
	if err := copyFile(layout.TrafficAgent, filepath.Join(trafficBin, "mosdns-traffic-agent"), 0o755); err != nil {
		return err
	}
	if err := copyDir(layout.MosDNSRoot, mosdnsConfig); err != nil {
		return err
	}
	if err := copyDir(layout.TrafficRoot, trafficConfig); err != nil {
		return err
	}
	if err := forceMosDNSAPILoopback(filepath.Join(mosdnsConfig, "config_custom.yaml")); err != nil {
		return err
	}
	if err := configureTrafficAgent(filepath.Join(trafficConfig, "config.json"), iface); err != nil {
		return err
	}

	pairs := []mosDNSBundleDeployPair{
		{source: mosdnsBin, target: filepath.Join(a.DataDir, "data", "binaries", "mosdns")},
		{source: trafficBin, target: filepath.Join(a.DataDir, "data", "binaries", "mosdns-traffic-agent")},
		{source: mosdnsConfig, target: filepath.Join(a.DataDir, "configs", "mosdns")},
		{source: trafficConfig, target: filepath.Join(a.DataDir, "configs", "monitor")},
	}
	return deployMosDNSBundlePairs(pairs)
}

func (a *App) replaceMosDNSBundle(ctx context.Context, install func() error) (bool, error) {
	wasRunning := a.Services.statusOne("mosdns").Running || a.Services.statusOne("mosdns-traffic-agent").Running
	if wasRunning {
		if _, err := a.Services.Stop(ctx, "mosdns"); err != nil {
			return false, fmt.Errorf("stop MosDNS bundle: %w", err)
		}
	}
	if err := install(); err != nil {
		if wasRunning && a.hasMosDNSBundle() {
			_, _ = a.Services.Start(ctx, "mosdns")
		}
		return false, err
	}
	if !wasRunning {
		return false, nil
	}
	if _, err := a.Services.Start(ctx, "mosdns"); err != nil {
		return false, fmt.Errorf("restart MosDNS bundle: %w", err)
	}
	return true, nil
}

func validateMosDNSBundleArchive(path string) error {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("read MosDNS ZIP: %w", err)
	}
	defer reader.Close()
	var expanded uint64
	for _, entry := range reader.File {
		if cleanArchivePath(entry.Name) == "" {
			return fmt.Errorf("MosDNS ZIP contains an unsafe path")
		}
		if entry.FileInfo().Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("MosDNS ZIP must not contain symbolic links")
		}
		expanded += entry.UncompressedSize64
		if expanded > mosDNSBundleMaxExpandedSize {
			return fmt.Errorf("MosDNS ZIP expands beyond %d MiB", mosDNSBundleMaxExpandedSize>>20)
		}
	}
	return nil
}

func findMosDNSBundleLayout(root string) (mosDNSBundleLayout, error) {
	var layout mosDNSBundleLayout
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || !entry.IsDir() || layout.MosDNSBinary != "" {
			return walkErr
		}
		candidate := mosDNSBundleLayout{
			MosDNSBinary: filepath.Join(path, "cus", "bin", "mosdns"),
			MosDNSRoot:   filepath.Join(path, "cus", "mosdns"),
			TrafficAgent: filepath.Join(path, "monitor", "bin", "mosdns-traffic-agent"),
			TrafficRoot:  filepath.Join(path, "monitor", "config"),
		}
		for _, required := range []string{
			candidate.MosDNSBinary,
			candidate.MosDNSRoot,
			candidate.TrafficAgent,
			candidate.TrafficRoot,
			filepath.Join(candidate.MosDNSRoot, "config_custom.yaml"),
			filepath.Join(candidate.TrafficRoot, "config.json"),
		} {
			if _, err := os.Stat(required); err != nil {
				return nil
			}
		}
		layout = candidate
		return filepath.SkipDir
	})
	if err != nil {
		return mosDNSBundleLayout{}, err
	}
	if layout.MosDNSBinary == "" {
		return mosDNSBundleLayout{}, fmt.Errorf("MosDNS ZIP must include cus/bin/mosdns, cus/mosdns/config_custom.yaml, monitor/bin/mosdns-traffic-agent and monitor/config/config.json")
	}
	return layout, nil
}

func validateLinuxAMD64ELF(path string) error {
	file, err := elf.Open(path)
	if err != nil {
		return fmt.Errorf("not a Linux ELF file: %w", err)
	}
	defer file.Close()
	if file.Machine != elf.EM_X86_64 {
		return fmt.Errorf("architecture mismatch: got %s, want amd64", file.Machine.String())
	}
	return nil
}

func forceMosDNSAPILoopback(path string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(content), "\n")
	inAPI := false
	apiIndent := 0
	updated := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		indent := len(line) - len(strings.TrimLeft(line, " \t"))
		if trimmed == "api:" {
			inAPI, apiIndent = true, indent
			continue
		}
		if inAPI && trimmed != "" && indent <= apiIndent {
			inAPI = false
		}
		if inAPI && strings.HasPrefix(trimmed, "http:") {
			lines[i] = line[:indent] + `http: "127.0.0.1:9099"`
			updated = true
			break
		}
	}
	if !updated {
		return fmt.Errorf("MosDNS config does not define api.http")
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0o644)
}

func configureTrafficAgent(path, iface string) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var config map[string]any
	if err := json.Unmarshal(content, &config); err != nil {
		return fmt.Errorf("read traffic-agent config: %w", err)
	}
	config["listen"] = "127.0.0.1:9199"
	config["mosdns_backend"] = "http://127.0.0.1:9099"
	config["cors_allowed_origins"] = []string{}
	if iface = strings.TrimSpace(iface); iface != "" {
		config["interfaces"] = []string{iface}
	}
	formatted, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(formatted, '\n'), 0o644)
}

type mosDNSBundleDeployPair struct {
	source string
	target string
	backup string
	hadOld bool
}

func deployMosDNSBundlePairs(pairs []mosDNSBundleDeployPair) error {
	for i := range pairs {
		pair := &pairs[i]
		if err := os.MkdirAll(filepath.Dir(pair.target), 0o755); err != nil {
			rollbackMosDNSBundlePairs(pairs[:i])
			return err
		}
		if _, err := os.Stat(pair.target); err == nil {
			pair.hadOld = true
			pair.backup = pair.target + ".backup-" + randomHex(6)
			if err := os.Rename(pair.target, pair.backup); err != nil {
				rollbackMosDNSBundlePairs(pairs[:i])
				return err
			}
		}
		if err := os.Rename(pair.source, pair.target); err != nil {
			if pair.hadOld {
				_ = os.Rename(pair.backup, pair.target)
			}
			rollbackMosDNSBundlePairs(pairs[:i])
			return err
		}
	}
	for _, pair := range pairs {
		if pair.hadOld {
			_ = os.RemoveAll(pair.backup)
		}
	}
	return nil
}

func rollbackMosDNSBundlePairs(pairs []mosDNSBundleDeployPair) {
	for i := len(pairs) - 1; i >= 0; i-- {
		pair := pairs[i]
		_ = os.RemoveAll(pair.target)
		if pair.hadOld {
			_ = os.Rename(pair.backup, pair.target)
		}
	}
}

func (a *App) installMosDNSBundleFromURL(ctx context.Context, rawURL, iface string) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return fmt.Errorf("MosDNS ZIP URL must be a valid http or https URL")
	}
	uploads := filepath.Join(a.DataDir, "data", "uploads")
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(uploads, "mosdns-bundle-download-*.zip")
	if err != nil {
		return err
	}
	path := tmp.Name()
	defer os.Remove(path)
	client := a.downloadHTTPClient()
	client.Timeout = 2 * time.Minute
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		_ = tmp.Close()
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		_ = tmp.Close()
		return fmt.Errorf("download MosDNS ZIP: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_ = tmp.Close()
		return fmt.Errorf("download MosDNS ZIP: unexpected status %s", resp.Status)
	}
	if resp.ContentLength > mosDNSBundleMaxSize {
		_ = tmp.Close()
		return fmt.Errorf("MosDNS ZIP exceeds %d MiB", mosDNSBundleMaxSize>>20)
	}
	written, err := io.Copy(tmp, io.LimitReader(resp.Body, mosDNSBundleMaxSize+1))
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if written > mosDNSBundleMaxSize {
		return fmt.Errorf("MosDNS ZIP exceeds %d MiB", mosDNSBundleMaxSize>>20)
	}
	return a.installMosDNSBundle(ctx, path, iface)
}

func (a *App) installMosDNSBundleUpload(ctx context.Context, r *http.Request, iface string) error {
	if err := r.ParseMultipartForm(mosDNSBundleMaxSize); err != nil {
		return err
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return fmt.Errorf("MosDNS ZIP file is required: %w", err)
	}
	defer file.Close()
	if header.Size > mosDNSBundleMaxSize {
		return fmt.Errorf("MosDNS ZIP exceeds %d MiB", mosDNSBundleMaxSize>>20)
	}
	uploads := filepath.Join(a.DataDir, "data", "uploads")
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(uploads, "mosdns-bundle-upload-*.zip")
	if err != nil {
		return err
	}
	path := tmp.Name()
	defer os.Remove(path)
	written, err := io.Copy(tmp, io.LimitReader(file, mosDNSBundleMaxSize+1))
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if written > mosDNSBundleMaxSize {
		return fmt.Errorf("MosDNS ZIP exceeds %d MiB", mosDNSBundleMaxSize>>20)
	}
	return a.installMosDNSBundle(ctx, path, iface)
}
