package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testDigest(body []byte) string {
	sum := sha256.Sum256(body)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func TestRequiredMihomoSmartResources(t *testing.T) {
	cfg := map[string]any{
		"proxy-groups": []any{
			map[string]any{"name": "ordinary", "type": "select", "uselightgbm": true, "prefer-asn": true},
			map[string]any{"name": "smart-a", "type": "smart", "uselightgbm": true},
			map[string]any{"name": "smart-b", "type": "SMART", "prefer-asn": true},
		},
	}
	got := requiredMihomoSmartResources(cfg)
	if strings.Join(got, ",") != "lightgbm,asn" {
		t.Fatalf("required resources = %v", got)
	}
}

func TestMetaCoreCompatibilityRejectsSmartTypeAndFields(t *testing.T) {
	smartType := map[string]any{"proxy-groups": []any{map[string]any{"name": "US", "type": "smart"}}}
	if err := validateMihomoCoreConfigCompatibility("meta", smartType); err == nil || !strings.Contains(err.Error(), "type: smart") {
		t.Fatalf("Meta accepted Smart group: %v", err)
	}
	leftoverField := map[string]any{"proxy-groups": []any{map[string]any{"name": "US", "type": "select", "uselightgbm": false}}}
	if err := validateMihomoCoreConfigCompatibility("meta", leftoverField); err == nil || !strings.Contains(err.Error(), "uselightgbm") {
		t.Fatalf("Meta accepted Smart-only field: %v", err)
	}
	if err := validateMihomoCoreConfigCompatibility("smart", smartType); err != nil {
		t.Fatalf("Smart core rejected Smart group: %v", err)
	}
}

func TestSmartCoreSemanticValidation(t *testing.T) {
	valid := map[string]any{"proxy-groups": []any{map[string]any{
		"name": "US", "type": "smart", "uselightgbm": true, "collectdata": false,
		"prefer-asn": true, "sample-rate": 0.5, "tolerance": 30, "policy-priority": `HK\:Premium:1.5;US:2`,
	}}}
	if err := validateMihomoSmartConfigSemantics("smart", valid); err != nil {
		t.Fatalf("valid Smart semantics rejected: %v", err)
	}
	if err := validateMihomoSmartConfigSemantics("meta", valid); err != nil {
		t.Fatalf("Smart-only semantic validator should not run for Meta: %v", err)
	}
	tests := []struct {
		field string
		value any
		want  string
	}{
		{"sample-rate", 2.0, "sample-rate"},
		{"sample-rate", "0.5", "sample-rate"},
		{"tolerance", 1.5, "tolerance"},
		{"tolerance", 70000, "tolerance"},
		{"uselightgbm", "true", "布尔值"},
		{"collectdata", 1, "布尔值"},
		{"prefer-asn", "false", "布尔值"},
		{"policy-priority", "US", "pattern:factor"},
		{"policy-priority", "US:0", "正数"},
	}
	for _, test := range tests {
		group := map[string]any{"name": "US", "type": "smart", test.field: test.value}
		err := validateMihomoSmartConfigSemantics("smart", map[string]any{"proxy-groups": []any{group}})
		if err == nil || !strings.Contains(err.Error(), test.want) {
			t.Fatalf("field %s=%v error = %v, want %q", test.field, test.value, err, test.want)
		}
	}
	if err := validateSmartPolicyPriority(""); err != nil {
		t.Fatalf("empty policy-priority should mean unset: %v", err)
	}
}

func TestMetaCoreCannotApplyPreservedSmartUserConfig(t *testing.T) {
	app := newTestApp(t)
	insertSetupRow(t, app, "meta", false, "")
	before, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		t.Fatal(err)
	}
	custom := strings.Replace(testMihomoConfigYAML("Smart"), "type: select", "type: smart", 1)
	userRel := "configs/mihomo/user_configs/smart-preserved.yaml"
	if err := app.writeTextFile(userRel, custom); err != nil {
		t.Fatal(err)
	}
	if _, err := app.applyMihomoUserConfig(context.Background(), userRel, false, "test"); err == nil || !strings.Contains(err.Error(), "type: smart") {
		t.Fatalf("Meta applied preserved Smart config: %v", err)
	}
	after, err := app.readTextFile(mihomoActiveConfigRelPath)
	if err != nil || after != before {
		t.Fatalf("rejected Smart config changed active config: err=%v", err)
	}
}

func TestInstalledSmartResourceRequiresVerifiedReceiptAndMatchingFile(t *testing.T) {
	app := newTestApp(t)
	spec := mihomoSmartResourceSpecs()["lightgbm"]
	target := app.smartResourceTarget(spec)
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		t.Fatal(err)
	}
	body := []byte("verified model payload")
	if err := os.WriteFile(target, body, 0644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	receipt := smartResourceReceipt{
		Digest: testDigest(body), Size: int64(len(body)), SourceURL: spec.Source,
		VerificationSource: smartResourceVerificationSource, InstalledAt: time.Now(), FileModTimeUnixNS: info.ModTime().UnixNano(),
	}
	if err := writeSmartResourceReceipt(smartResourceReceiptPath(target), receipt); err != nil {
		t.Fatal(err)
	}
	ready := app.installedSmartResourceState(spec)
	if ready.Status != "ready" || !ready.Verified || ready.Progress != 100 {
		t.Fatalf("verified resource state = %+v", ready)
	}
	if err := os.Chmod(target, 0); err != nil {
		t.Fatal(err)
	}
	if cached := app.installedSmartResourceState(spec); cached.Status != "ready" || !cached.Verified {
		t.Fatalf("matching size/mtime receipt did not use fast ready path: %+v", cached)
	}
	if err := os.Chmod(target, 0644); err != nil {
		t.Fatal(err)
	}
	corrupt := append([]byte(nil), body...)
	corrupt[0] ^= 0xff
	if err := os.WriteFile(target, corrupt, 0644); err != nil {
		t.Fatal(err)
	}
	invalid := app.installedSmartResourceState(spec)
	if invalid.Status == "ready" || invalid.Verified {
		t.Fatalf("corrupt resource was accepted: %+v", invalid)
	}
}

func TestFailedSmartResourceJobDoesNotHideVerifiedDiskState(t *testing.T) {
	app := newTestApp(t)
	spec := mihomoSmartResourceSpecs()["lightgbm"]
	target := app.smartResourceTarget(spec)
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		t.Fatal(err)
	}
	body := []byte("verified replacement model")
	if err := os.WriteFile(target, body, 0644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeSmartResourceReceipt(smartResourceReceiptPath(target), smartResourceReceipt{
		Digest: testDigest(body), Size: int64(len(body)), SourceURL: spec.Source,
		VerificationSource: smartResourceVerificationSource, InstalledAt: time.Now(), FileModTimeUnixNS: info.ModTime().UnixNano(),
	}); err != nil {
		t.Fatal(err)
	}
	app.smartResourceJobs[spec.Key] = smartResourceState{Key: spec.Key, Status: "failed", Error: "old network failure"}
	state := app.smartResourceStates()[spec.Key]
	if state.Status != "ready" || !state.Verified {
		t.Fatalf("verified disk state was hidden by stale failure: %+v", state)
	}
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	state = app.smartResourceStates()[spec.Key]
	if state.Status != "failed" || state.Error != "old network failure" {
		t.Fatalf("real failed state was not preserved when disk was missing: %+v", state)
	}
}

func TestSmartResourceRoutesExposeOfficialSourcesAndRejectUnknownKey(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	status := requestJSON(t, app, http.MethodGet, "/api/v1/mihomo/smart-resources", token, nil)
	if status.Code != http.StatusOK ||
		!strings.Contains(status.Body.String(), `"core_type":"meta"`) || !strings.Contains(status.Body.String(), `"core_compatible":false`) ||
		!strings.Contains(status.Body.String(), "github.com/vernesong/mihomo/releases/download/LightGBM-Model/Model.bin") ||
		!strings.Contains(status.Body.String(), "github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb") {
		t.Fatalf("Smart resource status mismatch: status=%d body=%s", status.Code, status.Body.String())
	}
	blocked := requestJSON(t, app, http.MethodPost, "/api/v1/mihomo/smart-resources/download", token, map[string]any{"resource": "lightgbm"})
	if blocked.Code != http.StatusConflict || !strings.Contains(blocked.Body.String(), "smart_core_required") {
		t.Fatalf("Meta resource download was not blocked: status=%d body=%s", blocked.Code, blocked.Body.String())
	}
	insertSetupRow(t, app, "smart", false, "")
	unknown := requestJSON(t, app, http.MethodPost, "/api/v1/mihomo/smart-resources/download", token, map[string]any{"resource": "other"})
	if unknown.Code != http.StatusBadRequest || !strings.Contains(unknown.Body.String(), "unknown_smart_resource") {
		t.Fatalf("unknown resource response mismatch: status=%d body=%s", unknown.Code, unknown.Body.String())
	}
}

func TestSmartResourceCancellationReturnsJobToRetryableIdle(t *testing.T) {
	app := newTestApp(t)
	ctx, cancel := context.WithCancel(context.Background())
	jobID := int64(42)
	app.smartResourceJobs["lightgbm"] = smartResourceState{Key: "lightgbm", Status: "downloading", JobID: jobID}
	app.smartResourceCancels["lightgbm"] = smartResourceCancelEntry{JobID: jobID, Cancel: cancel}
	if !app.cancelSmartResourceDownload("lightgbm") {
		t.Fatal("running Smart resource job was not cancelled")
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("cancel func was not invoked")
	}
	app.failSmartResourceDownload(mihomoSmartResourceSpecs()["lightgbm"], jobID, context.Canceled)
	state := app.smartResourceJobs["lightgbm"]
	if state.Status != "idle" || state.Progress != 0 || state.Error != "" || !strings.Contains(state.Message, "已取消") {
		t.Fatalf("cancelled job state = %+v", state)
	}
}

func TestSmartResourceMetadataHonorsCancelledContext(t *testing.T) {
	app := newTestApp(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	_, err := app.smartResourceReleaseAsset(ctx, mihomoSmartResourceSpecs()["lightgbm"], nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled metadata error = %v", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("cancelled metadata lookup returned too slowly: %s", elapsed)
	}
}
