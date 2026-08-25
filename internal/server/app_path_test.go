package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNewNormalizesRelativeDataDir(t *testing.T) {
	workingDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	dataDir, err := filepath.Rel(workingDir, filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	app, err := New(Options{DataDir: dataDir, Version: "test"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(app.Close)
	if !filepath.IsAbs(app.DataDir) {
		t.Fatalf("DataDir must be absolute, got %q", app.DataDir)
	}
}
