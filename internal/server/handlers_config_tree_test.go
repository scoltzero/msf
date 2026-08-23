package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestConfigTreeIncludesDeepFilesAndReportsAbsoluteRoot(t *testing.T) {
	app := newTestApp(t)
	deepRel := filepath.Join("configs", "one", "two", "three", "four", "five", "six", "deep.yaml")
	deepPath := filepath.Join(app.DataDir, deepRel)
	if err := os.MkdirAll(filepath.Dir(deepPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(deepPath, []byte("enabled: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/api/v1/config/tree?path=configs", nil)
	res := httptest.NewRecorder()
	app.handleConfigTree(res, req)
	if res.Code != 200 {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}

	var payload struct {
		Root         string     `json:"root"`
		AbsolutePath string     `json:"absolute_path"`
		Tree         []FileNode `json:"tree"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Root != "configs" {
		t.Fatalf("root=%q want configs", payload.Root)
	}
	wantRoot := filepath.Join(app.DataDir, "configs")
	if payload.AbsolutePath != wantRoot {
		t.Fatalf("absolute_path=%q want %q", payload.AbsolutePath, wantRoot)
	}
	wantRel := filepath.ToSlash(deepRel)
	if !configTreeContains(payload.Tree, wantRel) {
		t.Fatalf("deep file %q missing from config tree", wantRel)
	}
}

func TestMosDNSConfigTreeUsesMosDNSRootAndIncludesDeepFiles(t *testing.T) {
	app := newTestApp(t)
	deepRel := filepath.Join("configs", "mosdns", "custom", "one", "two", "three", "four", "five", "deep.yaml")
	deepPath := filepath.Join(app.DataDir, deepRel)
	if err := os.MkdirAll(filepath.Dir(deepPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(deepPath, []byte("enabled: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/api/v1/mosdns/config/files", nil)
	res := httptest.NewRecorder()
	app.handleMosDNSConfigFiles(res, req)
	if res.Code != 200 {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}

	var payload struct {
		Root         string     `json:"root"`
		AbsolutePath string     `json:"absolute_path"`
		Data         []FileNode `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Root != "configs/mosdns" {
		t.Fatalf("root=%q want configs/mosdns", payload.Root)
	}
	wantRoot := filepath.Join(app.DataDir, "configs", "mosdns")
	if payload.AbsolutePath != wantRoot {
		t.Fatalf("absolute_path=%q want %q", payload.AbsolutePath, wantRoot)
	}
	wantRel := filepath.ToSlash(deepRel)
	if !configTreeContains(payload.Data, wantRel) {
		t.Fatalf("deep MosDNS file %q missing from config tree", wantRel)
	}
}

func configTreeContains(nodes []FileNode, path string) bool {
	for _, node := range nodes {
		if node.Path == path || configTreeContains(node.Children, path) {
			return true
		}
	}
	return false
}
