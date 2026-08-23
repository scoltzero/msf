package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServiceStartReportsNewStdoutFailure(t *testing.T) {
	app := newTestApp(t)
	installTestMihomoBinary(t, app, "echo 'level=fatal msg=proxy group member not found'\nexit 1\n")

	_, err := app.Services.Start(context.Background(), "mihomo")
	if err == nil || !strings.Contains(err.Error(), "proxy group member not found") {
		t.Fatalf("stdout startup failure should be returned, got %v", err)
	}
}

func TestRemovePIDFileOnlyRemovesOwnedProcess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "service.pid")
	if err := os.WriteFile(path, []byte("222"), 0644); err != nil {
		t.Fatal(err)
	}
	removePIDFileIfMatches(path, 111)
	if got := readPID(path); got != 222 {
		t.Fatalf("old process cleanup removed replacement PID: got %d", got)
	}
	removePIDFileIfMatches(path, 222)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("owned PID file should be removed, stat err=%v", err)
	}
}

func TestProcessZombieCrossHandlesSpacesAndParenthesesInComm(t *testing.T) {
	oldRoot := processProcRoot
	root := t.TempDir()
	processProcRoot = root
	t.Cleanup(func() { processProcRoot = oldRoot })
	pidDir := filepath.Join(root, "123")
	if err := os.MkdirAll(pidDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pidDir, "stat"), []byte("123 (worker name)) Z 1 2 3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !processZombieCross(123) {
		t.Fatal("zombie process was treated as alive")
	}
	if err := os.WriteFile(filepath.Join(pidDir, "stat"), []byte("123 (worker name)) S 1 2 3\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if processZombieCross(123) {
		t.Fatal("running process was treated as zombie")
	}
}
