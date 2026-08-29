package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const smartResourceVerificationSource = "github_release_asset_digest"

type smartResourceSpec struct {
	Key      string
	Label    string
	FileName string
	Owner    string
	Repo     string
	Tag      string
	Asset    string
	Source   string
}

type smartResourceState struct {
	Key                string `json:"key"`
	Label              string `json:"label"`
	FileName           string `json:"file_name"`
	SourceURL          string `json:"source_url"`
	Status             string `json:"status"`
	Progress           int    `json:"progress"`
	Message            string `json:"message,omitempty"`
	Error              string `json:"error,omitempty"`
	Size               int64  `json:"size,omitempty"`
	Digest             string `json:"digest,omitempty"`
	Verified           bool   `json:"verified"`
	VerificationSource string `json:"verification_source,omitempty"`
}

type smartResourceReceipt struct {
	Digest             string    `json:"digest"`
	Size               int64     `json:"size"`
	SourceURL          string    `json:"source_url"`
	VerificationSource string    `json:"verification_source"`
	InstalledAt        time.Time `json:"installed_at"`
}

func mihomoSmartResourceSpecs() map[string]smartResourceSpec {
	return map[string]smartResourceSpec{
		"lightgbm": {
			Key: "lightgbm", Label: "LightGBM 模型", FileName: "Model.bin",
			Owner: "vernesong", Repo: "mihomo", Tag: "LightGBM-Model", Asset: "Model.bin",
			Source: "https://github.com/vernesong/mihomo/releases/download/LightGBM-Model/Model.bin",
		},
		"asn": {
			Key: "asn", Label: "ASN 数据库", FileName: "ASN.mmdb",
			Owner: "MetaCubeX", Repo: "meta-rules-dat", Asset: "GeoLite2-ASN.mmdb",
			Source: "https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb",
		},
	}
}

func (a *App) smartResourceTarget(spec smartResourceSpec) string {
	return filepath.Join(a.DataDir, "configs", "mihomo", spec.FileName)
}

func smartResourceReceiptPath(target string) string {
	return target + ".msf-resource.json"
}

func (a *App) installedSmartResourceState(spec smartResourceSpec) smartResourceState {
	state := smartResourceState{
		Key: spec.Key, Label: spec.Label, FileName: spec.FileName, SourceURL: spec.Source,
		Status: "idle", Message: "尚未下载或完整性未经 MSF 验证",
	}
	target := a.smartResourceTarget(spec)
	receiptRaw, err := os.ReadFile(smartResourceReceiptPath(target))
	if err != nil {
		return state
	}
	var receipt smartResourceReceipt
	if json.Unmarshal(receiptRaw, &receipt) != nil || receipt.Size <= 0 || strings.TrimSpace(receipt.Digest) == "" {
		return state
	}
	info, err := os.Stat(target)
	if err != nil || info.Size() != receipt.Size {
		return state
	}
	actual, err := verifySHA256File(target, receipt.Digest)
	if err != nil {
		state.Message = "资源文件完整性校验失败，需要重新下载"
		return state
	}
	state.Status = "ready"
	state.Progress = 100
	state.Message = "已下载并通过 SHA-256 校验"
	state.Size = receipt.Size
	state.Digest = actual
	state.Verified = true
	state.VerificationSource = receipt.VerificationSource
	return state
}

func (a *App) smartResourceStates() map[string]smartResourceState {
	result := make(map[string]smartResourceState)
	for key, spec := range mihomoSmartResourceSpecs() {
		result[key] = a.installedSmartResourceState(spec)
	}
	a.smartResourceMu.RLock()
	defer a.smartResourceMu.RUnlock()
	for key, state := range a.smartResourceJobs {
		if state.Status == "downloading" || state.Status == "failed" {
			result[key] = state
		}
	}
	return result
}

func (a *App) handleMihomoSmartResources(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"resources": a.smartResourceStates()}})
}

func (a *App) handleMihomoSmartResourceDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Resource  string   `json:"resource"`
		Resources []string `json:"resources"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	keys := append([]string(nil), req.Resources...)
	if strings.TrimSpace(req.Resource) != "" {
		keys = append(keys, req.Resource)
	}
	if len(keys) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "resource is required")
		return
	}
	specs := mihomoSmartResourceSpecs()
	started := make([]string, 0, len(keys))
	for _, raw := range keys {
		key := strings.ToLower(strings.TrimSpace(raw))
		spec, ok := specs[key]
		if !ok {
			writeError(w, http.StatusBadRequest, "unknown_smart_resource", "unknown Smart resource "+key)
			return
		}
		if a.startSmartResourceDownload(spec) {
			started = append(started, key)
		}
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"success": true, "data": map[string]any{"started": started, "resources": a.smartResourceStates()}})
}

func (a *App) startSmartResourceDownload(spec smartResourceSpec) bool {
	a.smartResourceMu.Lock()
	if a.smartResourceJobs == nil {
		a.smartResourceJobs = make(map[string]smartResourceState)
	}
	if current, ok := a.smartResourceJobs[spec.Key]; ok && current.Status == "downloading" {
		a.smartResourceMu.Unlock()
		return false
	}
	a.smartResourceJobs[spec.Key] = smartResourceState{
		Key: spec.Key, Label: spec.Label, FileName: spec.FileName, SourceURL: spec.Source,
		Status: "downloading", Progress: 1, Message: "正在读取官方发布信息",
	}
	a.smartResourceMu.Unlock()
	go a.runSmartResourceDownload(spec)
	return true
}

func (a *App) updateSmartResourceState(key string, update func(*smartResourceState)) {
	a.smartResourceMu.Lock()
	defer a.smartResourceMu.Unlock()
	state := a.smartResourceJobs[key]
	update(&state)
	a.smartResourceJobs[key] = state
}

func (a *App) smartResourceReleaseAsset(spec smartResourceSpec) (githubAsset, error) {
	var release githubRelease
	var err error
	if spec.Tag != "" {
		release, err = a.fetchReleaseByTag(spec.Owner, spec.Repo, spec.Tag)
	} else {
		release, err = a.fetchLatestRelease(spec.Owner, spec.Repo)
	}
	if err != nil {
		return githubAsset{}, err
	}
	for _, asset := range release.Assets {
		if asset.Name == spec.Asset {
			if asset.Size <= 0 {
				return githubAsset{}, fmt.Errorf("official asset %s has no valid size", spec.Asset)
			}
			if _, err := canonicalSHA256Digest(asset.Digest); err != nil {
				return githubAsset{}, fmt.Errorf("official asset %s has no valid SHA-256 digest: %w", spec.Asset, err)
			}
			return asset, nil
		}
	}
	return githubAsset{}, fmt.Errorf("official release does not include %s", spec.Asset)
}

func (a *App) runSmartResourceDownload(spec smartResourceSpec) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	asset, err := a.smartResourceReleaseAsset(spec)
	if err != nil {
		a.failSmartResourceDownload(spec, err)
		return
	}
	digest, _ := canonicalSHA256Digest(asset.Digest)
	a.updateSmartResourceState(spec.Key, func(state *smartResourceState) {
		state.Size = asset.Size
		state.Digest = digest
		state.VerificationSource = smartResourceVerificationSource
		state.Message = "正在从官方发布资产下载"
		state.Progress = 5
	})
	target := a.smartResourceTarget(spec)
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		a.failSmartResourceDownload(spec, err)
		return
	}
	tmp := target + ".msf-download"
	_ = os.Remove(tmp)
	effectiveURL := a.mihomoCoreSwitchDownloadURL(asset.BrowserDownloadURL)
	verifiedDigest, err := a.downloadVerifiedResolvedURLContext(ctx, effectiveURL, digest, tmp, func(event DownloadEvent) {
		a.updateSmartResourceState(spec.Key, func(state *smartResourceState) {
			state.Progress = event.Progress
			state.Message = event.Message
		})
	})
	if err != nil {
		_ = os.Remove(tmp)
		a.failSmartResourceDownload(spec, err)
		return
	}
	if info, statErr := os.Stat(tmp); statErr != nil || info.Size() != asset.Size {
		_ = os.Remove(tmp)
		if statErr != nil {
			a.failSmartResourceDownload(spec, statErr)
		} else {
			a.failSmartResourceDownload(spec, fmt.Errorf("downloaded size %d does not match official size %d", info.Size(), asset.Size))
		}
		return
	}
	if err := copyFile(tmp, target, 0644); err != nil {
		_ = os.Remove(tmp)
		a.failSmartResourceDownload(spec, err)
		return
	}
	_ = os.Remove(tmp)
	receipt := smartResourceReceipt{
		Digest: verifiedDigest, Size: asset.Size, SourceURL: asset.BrowserDownloadURL,
		VerificationSource: smartResourceVerificationSource, InstalledAt: time.Now(),
	}
	if err := writeSmartResourceReceipt(smartResourceReceiptPath(target), receipt); err != nil {
		a.failSmartResourceDownload(spec, err)
		return
	}
	a.updateSmartResourceState(spec.Key, func(state *smartResourceState) {
		state.Status = "ready"
		state.Progress = 100
		state.Message = "已下载并通过 SHA-256 校验"
		state.Error = ""
		state.Verified = true
		state.Digest = verifiedDigest
	})
}

func writeSmartResourceReceipt(path string, receipt smartResourceReceipt) error {
	raw, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".smart-resource-receipt-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(0600); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

func (a *App) failSmartResourceDownload(spec smartResourceSpec, err error) {
	a.updateSmartResourceState(spec.Key, func(state *smartResourceState) {
		state.Status = "failed"
		state.Error = err.Error()
		state.Message = "下载失败，可重试"
		state.Verified = false
	})
}

func requiredMihomoSmartResources(cfg map[string]any) []string {
	groups, _ := cfg["proxy-groups"].([]any)
	required := map[string]bool{}
	for _, raw := range groups {
		group, _ := raw.(map[string]any)
		if !strings.EqualFold(strings.TrimSpace(stringMapValue(group, "type")), "smart") {
			continue
		}
		if value, _ := group["uselightgbm"].(bool); value {
			required["lightgbm"] = true
		}
		if value, _ := group["prefer-asn"].(bool); value {
			required["asn"] = true
		}
	}
	keys := make([]string, 0, 2)
	for _, key := range []string{"lightgbm", "asn"} {
		if required[key] {
			keys = append(keys, key)
		}
	}
	return keys
}

func validateMihomoCoreConfigCompatibility(coreType string, cfg map[string]any) error {
	if normalizeMihomoCoreType(coreType) != "meta" {
		return nil
	}
	groups, _ := cfg["proxy-groups"].([]any)
	smartOnlyFields := []string{"policy-priority", "uselightgbm", "collectdata", "sample-rate", "prefer-asn"}
	for index, raw := range groups {
		group, _ := raw.(map[string]any)
		name := strings.TrimSpace(stringMapValue(group, "name"))
		if name == "" {
			name = fmt.Sprintf("proxy-groups[%d]", index)
		}
		if strings.EqualFold(strings.TrimSpace(stringMapValue(group, "type")), "smart") {
			return fmt.Errorf("Meta 核心配置不支持 Smart 代理组 %q（proxy-groups[%d].type: smart）", name, index)
		}
		for _, field := range smartOnlyFields {
			if _, exists := group[field]; exists {
				return fmt.Errorf("Meta 核心配置中的代理组 %q 不能包含 Smart 专属字段 %q", name, field)
			}
		}
	}
	return nil
}

func (a *App) missingMihomoSmartResources(cfg map[string]any) []smartResourceState {
	states := a.smartResourceStates()
	missing := make([]smartResourceState, 0, 2)
	for _, key := range requiredMihomoSmartResources(cfg) {
		state := states[key]
		if state.Status != "ready" || !state.Verified {
			missing = append(missing, state)
		}
	}
	return missing
}
