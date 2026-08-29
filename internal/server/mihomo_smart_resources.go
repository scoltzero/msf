package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const smartResourceVerificationSource = "github_release_asset_digest"

const (
	smartResourceDownloadTimeout        = 30 * time.Minute
	smartResourceMetadataAttemptTimeout = 12 * time.Second
	smartResourceMetadataAttempts       = 2
	smartResourceMetadataRetryDelay     = 500 * time.Millisecond
)

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
	JobID              int64  `json:"-"`
}

type smartResourceCancelEntry struct {
	JobID  int64
	Cancel context.CancelFunc
}

type smartResourceReceipt struct {
	Digest             string    `json:"digest"`
	Size               int64     `json:"size"`
	SourceURL          string    `json:"source_url"`
	VerificationSource string    `json:"verification_source"`
	InstalledAt        time.Time `json:"installed_at"`
	FileModTimeUnixNS  int64     `json:"file_mod_time_unix_ns,omitempty"`
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
	if _, err := canonicalSHA256Digest(receipt.Digest); err != nil {
		return state
	}
	info, err := os.Stat(target)
	if err != nil || info.Size() != receipt.Size {
		return state
	}
	actual := receipt.Digest
	if receipt.FileModTimeUnixNS == 0 || receipt.FileModTimeUnixNS != info.ModTime().UnixNano() {
		actual, err = verifySHA256File(target, receipt.Digest)
		if err != nil {
			state.Message = "资源文件完整性校验失败，需要重新下载"
			return state
		}
		receipt.FileModTimeUnixNS = info.ModTime().UnixNano()
		_ = writeSmartResourceReceipt(smartResourceReceiptPath(target), receipt)
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
	a.smartResourceMu.RLock()
	jobs := make(map[string]smartResourceState, len(a.smartResourceJobs))
	for key, state := range a.smartResourceJobs {
		jobs[key] = state
	}
	a.smartResourceMu.RUnlock()
	for key, spec := range mihomoSmartResourceSpecs() {
		if state, ok := jobs[key]; ok && state.Status == "downloading" {
			result[key] = state
			continue
		}
		installed := a.installedSmartResourceState(spec)
		if installed.Status == "ready" && installed.Verified {
			result[key] = installed
			continue
		}
		if state, ok := jobs[key]; ok && state.Status == "failed" {
			result[key] = state
			continue
		}
		result[key] = installed
	}
	return result
}

func (a *App) handleMihomoSmartResources(w http.ResponseWriter, _ *http.Request) {
	coreType := a.selectedMihomoCoreType()
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"resources": a.smartResourceStates(), "core_type": coreType, "core_compatible": coreType == "smart",
	}})
}

func (a *App) handleMihomoSmartResourceDownload(w http.ResponseWriter, r *http.Request) {
	if a.selectedMihomoCoreType() != "smart" {
		writeError(w, http.StatusConflict, "smart_core_required", "请先切换到 Smart 实验版核心，再下载 Smart 专属资源")
		return
	}
	keys, ok := decodeSmartResourceKeys(w, r)
	if !ok {
		return
	}
	specs := mihomoSmartResourceSpecs()
	started := make([]string, 0, len(keys))
	for _, key := range keys {
		spec, exists := specs[key]
		if !exists {
			writeError(w, http.StatusBadRequest, "unknown_smart_resource", "unknown Smart resource "+key)
			return
		}
		if a.startSmartResourceDownload(spec) {
			started = append(started, key)
		}
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"success": true, "data": map[string]any{"started": started, "resources": a.smartResourceStates()}})
}

func decodeSmartResourceKeys(w http.ResponseWriter, r *http.Request) ([]string, bool) {
	var req struct {
		Resource  string   `json:"resource"`
		Resources []string `json:"resources"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return nil, false
	}
	keys := append([]string(nil), req.Resources...)
	if strings.TrimSpace(req.Resource) != "" {
		keys = append(keys, req.Resource)
	}
	if len(keys) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "resource is required")
		return nil, false
	}
	unique := make([]string, 0, len(keys))
	seen := map[string]bool{}
	for _, raw := range keys {
		key := strings.ToLower(strings.TrimSpace(raw))
		if key != "" && !seen[key] {
			seen[key] = true
			unique = append(unique, key)
		}
	}
	return unique, true
}

func (a *App) handleMihomoSmartResourceCancel(w http.ResponseWriter, r *http.Request) {
	keys, ok := decodeSmartResourceKeys(w, r)
	if !ok {
		return
	}
	cancelled := make([]string, 0, len(keys))
	for _, key := range keys {
		if _, exists := mihomoSmartResourceSpecs()[key]; !exists {
			writeError(w, http.StatusBadRequest, "unknown_smart_resource", "unknown Smart resource "+key)
			return
		}
		if a.cancelSmartResourceDownload(key) {
			cancelled = append(cancelled, key)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"cancelled": cancelled, "resources": a.smartResourceStates()}})
}

func (a *App) startSmartResourceDownload(spec smartResourceSpec) bool {
	a.smartResourceMu.Lock()
	if a.smartResourceJobs == nil {
		a.smartResourceJobs = make(map[string]smartResourceState)
	}
	if a.smartResourceCancels == nil {
		a.smartResourceCancels = make(map[string]smartResourceCancelEntry)
	}
	if current, ok := a.smartResourceJobs[spec.Key]; ok && current.Status == "downloading" {
		a.smartResourceMu.Unlock()
		return false
	}
	jobID := time.Now().UnixNano()
	ctx, cancel := context.WithTimeout(context.Background(), smartResourceDownloadTimeout)
	a.smartResourceJobs[spec.Key] = smartResourceState{
		Key: spec.Key, Label: spec.Label, FileName: spec.FileName, SourceURL: spec.Source,
		Status: "downloading", Progress: 1, Message: "正在连接官方发布服务", JobID: jobID,
	}
	a.smartResourceCancels[spec.Key] = smartResourceCancelEntry{JobID: jobID, Cancel: cancel}
	a.smartResourceMu.Unlock()
	go a.runSmartResourceDownload(ctx, spec, jobID)
	return true
}

func (a *App) cancelSmartResourceDownload(key string) bool {
	a.smartResourceMu.Lock()
	entry, ok := a.smartResourceCancels[key]
	if ok {
		state := a.smartResourceJobs[key]
		if state.JobID == entry.JobID && state.Status == "downloading" {
			state.Message = "正在取消下载"
			a.smartResourceJobs[key] = state
		} else {
			ok = false
		}
	}
	a.smartResourceMu.Unlock()
	if ok {
		entry.Cancel()
	}
	return ok
}

func (a *App) updateSmartResourceState(key string, jobID int64, update func(*smartResourceState)) bool {
	a.smartResourceMu.Lock()
	defer a.smartResourceMu.Unlock()
	state := a.smartResourceJobs[key]
	if state.JobID != jobID {
		return false
	}
	update(&state)
	a.smartResourceJobs[key] = state
	return true
}

func (a *App) finishSmartResourceJob(key string, jobID int64) {
	a.smartResourceMu.Lock()
	defer a.smartResourceMu.Unlock()
	if entry, ok := a.smartResourceCancels[key]; ok && entry.JobID == jobID {
		entry.Cancel()
		delete(a.smartResourceCancels, key)
	}
}

func (a *App) smartResourceReleaseAsset(ctx context.Context, spec smartResourceSpec, heartbeat func(attempt int)) (githubAsset, error) {
	var release githubRelease
	var lastErr error
	for attempt := 1; attempt <= smartResourceMetadataAttempts; attempt++ {
		if heartbeat != nil {
			heartbeat(attempt)
		}
		attemptCtx, cancel := context.WithTimeout(ctx, smartResourceMetadataAttemptTimeout)
		if spec.Tag != "" {
			release, lastErr = a.fetchReleaseByTagContext(attemptCtx, spec.Owner, spec.Repo, spec.Tag)
		} else {
			release, lastErr = a.fetchLatestReleaseContext(attemptCtx, spec.Owner, spec.Repo)
		}
		cancel()
		if lastErr == nil {
			break
		}
		if ctx.Err() != nil {
			return githubAsset{}, ctx.Err()
		}
		if attempt < smartResourceMetadataAttempts {
			timer := time.NewTimer(smartResourceMetadataRetryDelay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return githubAsset{}, ctx.Err()
			case <-timer.C:
			}
		}
	}
	if lastErr != nil {
		return githubAsset{}, fmt.Errorf("读取官方发布信息失败（已重试 %d 次）: %w", smartResourceMetadataAttempts, lastErr)
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

func (a *App) runSmartResourceDownload(ctx context.Context, spec smartResourceSpec, jobID int64) {
	defer a.finishSmartResourceJob(spec.Key, jobID)
	asset, err := a.smartResourceReleaseAsset(ctx, spec, func(attempt int) {
		a.updateSmartResourceState(spec.Key, jobID, func(state *smartResourceState) {
			state.Progress = 1 + attempt
			state.Message = fmt.Sprintf("正在连接官方发布服务（第 %d/%d 次）", attempt, smartResourceMetadataAttempts)
		})
	})
	if err != nil {
		a.failSmartResourceDownload(spec, jobID, err)
		return
	}
	digest, _ := canonicalSHA256Digest(asset.Digest)
	a.updateSmartResourceState(spec.Key, jobID, func(state *smartResourceState) {
		state.Size = asset.Size
		state.Digest = digest
		state.VerificationSource = smartResourceVerificationSource
		state.Message = "正在从官方发布资产下载"
		state.Progress = 5
	})
	target := a.smartResourceTarget(spec)
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		a.failSmartResourceDownload(spec, jobID, err)
		return
	}
	tmp := target + ".msf-download"
	_ = os.Remove(tmp)
	effectiveURL := a.mihomoCoreSwitchDownloadURL(asset.BrowserDownloadURL)
	verifiedDigest, err := a.downloadVerifiedResolvedURLContext(ctx, effectiveURL, digest, tmp, func(event DownloadEvent) {
		a.updateSmartResourceState(spec.Key, jobID, func(state *smartResourceState) {
			state.Progress = event.Progress
			state.Message = event.Message
		})
	})
	if err != nil {
		_ = os.Remove(tmp)
		a.failSmartResourceDownload(spec, jobID, err)
		return
	}
	if info, statErr := os.Stat(tmp); statErr != nil || info.Size() != asset.Size {
		_ = os.Remove(tmp)
		if statErr != nil {
			a.failSmartResourceDownload(spec, jobID, statErr)
		} else {
			a.failSmartResourceDownload(spec, jobID, fmt.Errorf("downloaded size %d does not match official size %d", info.Size(), asset.Size))
		}
		return
	}
	if err := copyFile(tmp, target, 0644); err != nil {
		_ = os.Remove(tmp)
		a.failSmartResourceDownload(spec, jobID, err)
		return
	}
	_ = os.Remove(tmp)
	installedInfo, statErr := os.Stat(target)
	if statErr != nil {
		a.failSmartResourceDownload(spec, jobID, statErr)
		return
	}
	receipt := smartResourceReceipt{
		Digest: verifiedDigest, Size: asset.Size, SourceURL: asset.BrowserDownloadURL,
		VerificationSource: smartResourceVerificationSource, InstalledAt: time.Now(), FileModTimeUnixNS: installedInfo.ModTime().UnixNano(),
	}
	if err := writeSmartResourceReceipt(smartResourceReceiptPath(target), receipt); err != nil {
		a.failSmartResourceDownload(spec, jobID, err)
		return
	}
	a.updateSmartResourceState(spec.Key, jobID, func(state *smartResourceState) {
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

func (a *App) failSmartResourceDownload(spec smartResourceSpec, jobID int64, err error) {
	a.updateSmartResourceState(spec.Key, jobID, func(state *smartResourceState) {
		if errors.Is(err, context.Canceled) {
			state.Status = "idle"
			state.Progress = 0
			state.Error = ""
			state.Message = "下载已取消，可重新下载"
			state.Verified = false
			return
		}
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

func validateMihomoSmartConfigSemantics(coreType string, cfg map[string]any) error {
	if normalizeMihomoCoreType(coreType) != "smart" {
		return nil
	}
	groups, _ := cfg["proxy-groups"].([]any)
	for index, raw := range groups {
		group, _ := raw.(map[string]any)
		if !strings.EqualFold(strings.TrimSpace(stringMapValue(group, "type")), "smart") {
			continue
		}
		name := strings.TrimSpace(stringMapValue(group, "name"))
		if name == "" {
			name = fmt.Sprintf("proxy-groups[%d]", index)
		}
		for _, field := range []string{"uselightgbm", "collectdata", "prefer-asn"} {
			if value, exists := group[field]; exists {
				if _, ok := value.(bool); !ok {
					return fmt.Errorf("Smart 代理组 %q 的字段 %q 必须是布尔值", name, field)
				}
			}
		}
		if value, exists := group["sample-rate"]; exists {
			number, ok := smartNumericValue(value)
			if !ok || math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || number > 1 {
				return fmt.Errorf("Smart 代理组 %q 的 sample-rate 必须在 0 到 1 之间", name)
			}
		}
		if value, exists := group["tolerance"]; exists {
			number, ok := smartNumericValue(value)
			if !ok || number < 0 || number > 65535 || math.Trunc(number) != number {
				return fmt.Errorf("Smart 代理组 %q 的 tolerance 必须是 0 到 65535 之间的整数", name)
			}
		}
		if value, exists := group["policy-priority"]; exists {
			policy, ok := value.(string)
			if !ok {
				return fmt.Errorf("Smart 代理组 %q 的 policy-priority 必须是字符串", name)
			}
			if err := validateSmartPolicyPriority(policy); err != nil {
				return fmt.Errorf("Smart 代理组 %q 的 policy-priority 无效: %w", name, err)
			}
		}
	}
	return nil
}

func smartNumericValue(value any) (float64, bool) {
	switch number := value.(type) {
	case int:
		return float64(number), true
	case int8:
		return float64(number), true
	case int16:
		return float64(number), true
	case int32:
		return float64(number), true
	case int64:
		return float64(number), true
	case uint:
		return float64(number), true
	case uint8:
		return float64(number), true
	case uint16:
		return float64(number), true
	case uint32:
		return float64(number), true
	case uint64:
		return float64(number), true
	case float32:
		return float64(number), true
	case float64:
		return number, true
	default:
		return 0, false
	}
}

func validateSmartPolicyPriority(value string) error {
	lastUnescapedColon := func(text string) int {
		for index := len(text) - 1; index >= 0; index-- {
			if text[index] != ':' {
				continue
			}
			backslashes := 0
			for cursor := index - 1; cursor >= 0 && text[cursor] == '\\'; cursor-- {
				backslashes++
			}
			if backslashes%2 == 0 {
				return index
			}
		}
		return -1
	}
	for _, rawRule := range strings.Split(value, ";") {
		rule := strings.TrimSpace(rawRule)
		if rule == "" {
			continue
		}
		colon := lastUnescapedColon(rule)
		if colon <= 0 || colon == len(rule)-1 || strings.TrimSpace(rule[:colon]) == "" {
			return fmt.Errorf("规则 %q 必须使用 pattern:factor 格式", rule)
		}
		factor, err := strconv.ParseFloat(strings.TrimSpace(rule[colon+1:]), 64)
		if err != nil || math.IsNaN(factor) || math.IsInf(factor, 0) || factor <= 0 {
			return fmt.Errorf("规则 %q 的 factor 必须是正数", rule)
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
