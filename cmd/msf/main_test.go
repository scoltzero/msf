package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/scoltzero/msf/internal/cloudflareredirect"
)

func TestStopRuntimeTerminatesPIDAndRemovesPIDFiles(t *testing.T) {
	if _, err := exec.LookPath("sleep"); err != nil {
		t.Skip("sleep command not available")
	}
	dataDir := t.TempDir()
	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	t.Cleanup(func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
	})

	pidFile := filepath.Join(dataDir, "msf.pid")
	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644); err != nil {
		t.Fatal(err)
	}
	if err := stopRuntime(dataDir, true, 3*time.Second, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(pidFile); !os.IsNotExist(err) {
		t.Fatalf("pid file should be removed after stop, err=%v", err)
	}
}

func TestSafeRemoveAllRejectsBroadPaths(t *testing.T) {
	for _, path := range []string{"", ".", "/", "/opt", "/usr/local", "/mnt/user"} {
		if err := safeRemoveAll(path); err == nil {
			t.Fatalf("safeRemoveAll(%q) should reject broad path", path)
		}
	}
}

func TestSelfUpdateArchiveNameUsesRuntimeArch(t *testing.T) {
	if got := selfUpdateArchiveName("linux", "arm64"); got != "msf-linux-arm64.tar.gz" {
		t.Fatalf("selfUpdateArchiveName(linux, arm64) = %q", got)
	}
	if got := selfUpdateArchiveName("linux", "amd64"); got != "msf-linux-amd64.tar.gz" {
		t.Fatalf("selfUpdateArchiveName(linux, amd64) = %q", got)
	}
}

func TestDefaultDataDirUsesMSFEnvBeforeLegacyEnv(t *testing.T) {
	t.Setenv("MSF_DATA_DIR", "/tmp/msf-data")
	t.Setenv("MSM_FREE_DATA_DIR", "/tmp/msm-free-data")
	if got := defaultDataDir(); got != "/tmp/msf-data" {
		t.Fatalf("defaultDataDir() = %q, want MSF_DATA_DIR", got)
	}
}

func TestDefaultDataDirFallsBackToLegacyEnv(t *testing.T) {
	t.Setenv("MSF_DATA_DIR", "")
	t.Setenv("MSM_FREE_DATA_DIR", "/tmp/msm-free-data")
	if got := defaultDataDir(); got != "/tmp/msm-free-data" {
		t.Fatalf("defaultDataDir() = %q, want legacy MSM_FREE_DATA_DIR", got)
	}
}

func TestDockerRuntimeBlocksHostInstallers(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "docker")
	for _, item := range []struct {
		name string
		err  error
		want string
	}{
		{"update", updateRuntime(updateOptions{DataDir: t.TempDir()}), "Docker containers should be updated"},
		{"uninstall", uninstallRuntime(uninstallOptions{DataDir: t.TempDir()}), "Docker containers should be removed"},
		{"service install", serviceCommand("install", serviceOptions{DataDir: t.TempDir()}), "Docker containers do not use systemd"},
	} {
		if item.err == nil || !strings.Contains(item.err.Error(), item.want) {
			t.Fatalf("%s error = %v, want substring %q", item.name, item.err, item.want)
		}
	}
}

func TestCloudflareRedirectAcceptsConfigBeforeOrAfterAction(t *testing.T) {
	dataDir := t.TempDir()
	if err := cloudflareredirect.EnsureDefaultConfig(dataDir); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"cloudflare-redirect", "--config", dataDir, "status"}); err != nil {
		t.Fatalf("config before action failed: %v", err)
	}
	if err := run([]string{"cloudflare-redirect", "status", "--config", dataDir}); err != nil {
		t.Fatalf("config after action failed: %v", err)
	}
	if err := run([]string{"cf-redirect", "status", "--config", dataDir}); err != nil {
		t.Fatalf("short alias failed: %v", err)
	}
}

func TestCloudflareRedirectUsesDiscoveredDataDir(t *testing.T) {
	dataDir := t.TempDir()
	if err := cloudflareredirect.EnsureDefaultConfig(dataDir); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MSF_DATA_DIR", dataDir)
	if err := run([]string{"cloudflare-redirect", "status"}); err != nil {
		t.Fatalf("discovered data dir failed: %v", err)
	}
}
