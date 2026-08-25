package server

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestMosDNSLifecycleManagesTrafficAgentAsOneUnit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("service lifecycle requires POSIX signals")
	}
	app := newTestApp(t)
	installTestMosDNSBinary(t, app, "trap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n")
	agent := filepath.Join(app.DataDir, "data/binaries/mosdns-traffic-agent/mosdns-traffic-agent")
	if err := os.MkdirAll(filepath.Dir(agent), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(agent, []byte("#!/bin/sh\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(app.DataDir, "configs/mosdns/config_custom.yaml"), []byte("api:\n  http: \":9099\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	monitor := filepath.Join(app.DataDir, "configs/monitor")
	if err := os.MkdirAll(monitor, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(monitor, "config.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := app.Services.Start(context.Background(), "mosdns"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = app.Services.Stop(context.Background(), "mosdns") })
	if !app.Services.Status("mosdns").Running {
		t.Fatal("MosDNS unit should be running")
	}
	if !app.Services.Status("mosdns-traffic-agent").Running {
		t.Fatal("traffic agent should start with MosDNS")
	}
	if _, err := app.Services.Stop(context.Background(), "mosdns-traffic-agent"); err != nil {
		t.Fatal(err)
	}
	if status := app.Services.Status("mosdns"); status.Running || status.Status != "degraded" {
		t.Fatalf("MosDNS unit should be degraded when traffic agent stops: %+v", status)
	}
	if _, err := app.Services.Start(context.Background(), "mosdns-traffic-agent"); err != nil {
		t.Fatal(err)
	}

	if _, err := app.Services.Stop(context.Background(), "mosdns"); err != nil {
		t.Fatal(err)
	}
	if app.Services.Status("mosdns").Running || app.Services.Status("mosdns-traffic-agent").Running {
		t.Fatal("both MosDNS processes should stop together")
	}
}

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
