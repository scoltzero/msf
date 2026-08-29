package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	receipt := smartResourceReceipt{
		Digest: testDigest(body), Size: int64(len(body)), SourceURL: spec.Source,
		VerificationSource: smartResourceVerificationSource, InstalledAt: time.Now(),
	}
	if err := writeSmartResourceReceipt(smartResourceReceiptPath(target), receipt); err != nil {
		t.Fatal(err)
	}
	ready := app.installedSmartResourceState(spec)
	if ready.Status != "ready" || !ready.Verified || ready.Progress != 100 {
		t.Fatalf("verified resource state = %+v", ready)
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

func TestSmartResourceRoutesExposeOfficialSourcesAndRejectUnknownKey(t *testing.T) {
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")
	status := requestJSON(t, app, http.MethodGet, "/api/v1/mihomo/smart-resources", token, nil)
	if status.Code != http.StatusOK ||
		!strings.Contains(status.Body.String(), "github.com/vernesong/mihomo/releases/download/LightGBM-Model/Model.bin") ||
		!strings.Contains(status.Body.String(), "github.com/MetaCubeX/meta-rules-dat/releases/download/latest/GeoLite2-ASN.mmdb") {
		t.Fatalf("Smart resource status mismatch: status=%d body=%s", status.Code, status.Body.String())
	}
	unknown := requestJSON(t, app, http.MethodPost, "/api/v1/mihomo/smart-resources/download", token, map[string]any{"resource": "other"})
	if unknown.Code != http.StatusBadRequest || !strings.Contains(unknown.Body.String(), "unknown_smart_resource") {
		t.Fatalf("unknown resource response mismatch: status=%d body=%s", unknown.Code, unknown.Body.String())
	}
}
