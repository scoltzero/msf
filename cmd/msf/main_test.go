package main

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
	for _, path := range []string{"", ".", "/", "/opt", "/opt/", "/usr", "/usr/local", "/mnt", "/mnt/user", "/mnt/cache"} {
		if err := safeRemoveAll(path); err == nil {
			t.Fatalf("safeRemoveAll(%q) should reject broad path", path)
		}
	}
}

func TestResolveUninstallPurgeNonInteractiveKeepsData(t *testing.T) {
	oldTerminal, oldOut := uninstallInputIsTerminal, uninstallStdout
	uninstallInputIsTerminal = func() bool { return false }
	uninstallStdout = io.Discard
	t.Cleanup(func() {
		uninstallInputIsTerminal = oldTerminal
		uninstallStdout = oldOut
	})
	purge, err := resolveUninstallPurge(uninstallOptions{DataDir: "/opt/msf"})
	if err != nil {
		t.Fatal(err)
	}
	if purge {
		t.Fatal("non-interactive uninstall without --purge --yes should keep data")
	}
}

func TestResolveUninstallPurgeRequiresYesForNonInteractivePurge(t *testing.T) {
	oldTerminal := uninstallInputIsTerminal
	uninstallInputIsTerminal = func() bool { return false }
	t.Cleanup(func() { uninstallInputIsTerminal = oldTerminal })
	if _, err := resolveUninstallPurge(uninstallOptions{DataDir: "/opt/msf", Purge: true}); err == nil || !strings.Contains(err.Error(), "--yes") {
		t.Fatalf("expected --yes error, got %v", err)
	}
}

func TestResolveUninstallPurgeTTYConfirm(t *testing.T) {
	oldTerminal, oldIn, oldOut := uninstallInputIsTerminal, uninstallStdin, uninstallStdout
	uninstallInputIsTerminal = func() bool { return true }
	uninstallStdin = strings.NewReader("yes\n")
	uninstallStdout = io.Discard
	t.Cleanup(func() {
		uninstallInputIsTerminal = oldTerminal
		uninstallStdin = oldIn
		uninstallStdout = oldOut
	})
	purge, err := resolveUninstallPurge(uninstallOptions{DataDir: "/opt/msf"})
	if err != nil {
		t.Fatal(err)
	}
	if !purge {
		t.Fatal("yes confirmation should purge data")
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
		{"uninstall", uninstallRuntime(uninstallOptions{DataDir: t.TempDir()}), "Docker / Compose installs must be removed"},
		{"service install", serviceCommand("install", serviceOptions{DataDir: t.TempDir()}), "Docker containers do not use systemd"},
	} {
		if item.err == nil || !strings.Contains(item.err.Error(), item.want) {
			t.Fatalf("%s error = %v, want substring %q", item.name, item.err, item.want)
		}
	}
}

func TestFnOSRuntimeBlocksHostUninstallers(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "fnos")
	for _, item := range []struct {
		name string
		err  error
		want string
	}{
		{"uninstall", uninstallRuntime(uninstallOptions{DataDir: t.TempDir()}), "fnOS FPK installs must be removed"},
		{"service uninstall", serviceCommand("uninstall", serviceOptions{DataDir: t.TempDir()}), "fnOS FPK installs must be managed"},
	} {
		if item.err == nil || !strings.Contains(item.err.Error(), item.want) {
			t.Fatalf("%s error = %v, want substring %q", item.name, item.err, item.want)
		}
	}
}

func TestResolveUninstallDataDirPrefersSystemdService(t *testing.T) {
	oldSystemdDir := systemdServiceDir
	systemdServiceDir = t.TempDir()
	t.Cleanup(func() { systemdServiceDir = oldSystemdDir })
	dataDir := filepath.Join(t.TempDir(), "msf-data")
	service := `[Service]
Environment=MSF_DATA_DIR=` + dataDir + `
ExecStart=/usr/local/bin/msf serve --config /wrong
`
	if err := os.WriteFile(filepath.Join(systemdServiceDir, "msf.service"), []byte(service), 0644); err != nil {
		t.Fatal(err)
	}
	got := resolveUninstallDataDir(uninstallOptions{DataDir: "/opt/msf", ServiceName: "msf"})
	if got != dataDir {
		t.Fatalf("resolveUninstallDataDir() = %q, want %q", got, dataDir)
	}
	explicit := resolveUninstallDataDir(uninstallOptions{DataDir: "/explicit", DataDirExplicit: true, ServiceName: "msf"})
	if explicit != "/explicit" {
		t.Fatalf("explicit data dir = %q", explicit)
	}
}

func TestUninstallRuntimeKeepDataAndPurge(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "tarball")
	oldEUID, oldSystemdDir, oldTerminal, oldOut := currentEUID, systemdServiceDir, uninstallInputIsTerminal, uninstallStdout
	currentEUID = func() int { return 0 }
	systemdServiceDir = t.TempDir()
	uninstallInputIsTerminal = func() bool { return false }
	uninstallStdout = io.Discard
	t.Cleanup(func() {
		currentEUID = oldEUID
		systemdServiceDir = oldSystemdDir
		uninstallInputIsTerminal = oldTerminal
		uninstallStdout = oldOut
	})

	prefix := t.TempDir()
	binDir := filepath.Join(prefix, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(binDir, "msf")
	if err := os.WriteFile(bin, []byte("msf"), 0755); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(binDir, "msm")
	if err := os.Symlink(bin, alias); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	marker := filepath.Join(dataDir, "database", "msf.db")
	if err := os.MkdirAll(filepath.Dir(marker), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(marker, []byte("db"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := uninstallRuntime(uninstallOptions{Prefix: prefix, DataDir: dataDir, DataDirExplicit: true, AliasName: "msm", KeepData: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(bin); !os.IsNotExist(err) {
		t.Fatalf("binary should be removed, err=%v", err)
	}
	if _, err := os.Lstat(alias); !os.IsNotExist(err) {
		t.Fatalf("alias should be removed, err=%v", err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("data should be kept, err=%v", err)
	}

	if err := os.WriteFile(bin, []byte("msf"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := uninstallRuntime(uninstallOptions{Prefix: prefix, DataDir: dataDir, DataDirExplicit: true, AliasName: "msm", Purge: true, Yes: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dataDir); !os.IsNotExist(err) {
		t.Fatalf("data dir should be purged, err=%v", err)
	}
}

func TestStopOwnedRuntimeProcessesUsesPIDFiles(t *testing.T) {
	if _, err := exec.LookPath("sleep"); err != nil {
		t.Skip("sleep command not available")
	}
	dataDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dataDir, "data"), 0755); err != nil {
		t.Fatal(err)
	}
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
	pidFile := filepath.Join(dataDir, "data", "mihomo.pid")
	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644); err != nil {
		t.Fatal(err)
	}
	if err := stopOwnedRuntimeProcesses(dataDir, 3*time.Second); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(pidFile); !os.IsNotExist(err) {
		t.Fatalf("component pid file should be removed, err=%v", err)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("component process was not stopped")
	}
}

func TestStopOwnedRuntimeProcessesScansProcExeOwnership(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("proc exe ownership scan is linux-only")
	}
	sleepPath, err := exec.LookPath("sleep")
	if err != nil {
		t.Skip("sleep command not available")
	}
	dataDir := t.TempDir()
	binDir := filepath.Join(dataDir, "data", "binaries", "mihomo")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(sleepPath)
	if err != nil {
		t.Fatal(err)
	}
	ownedSleep := filepath.Join(binDir, "mihomo-test-sleep")
	if err := os.WriteFile(ownedSleep, b, 0755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(ownedSleep, "30")
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
	if err := stopOwnedRuntimeProcesses(dataDir, 3*time.Second); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("owned component process was not stopped")
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
