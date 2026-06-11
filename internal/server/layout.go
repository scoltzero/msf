package server

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func databasePath(dataDir string) string {
	dbDir := filepath.Join(dataDir, "database")
	preferred := filepath.Join(dbDir, "msf.db")
	if _, err := os.Stat(preferred); err == nil {
		return preferred
	}
	// Pre-rename installs (our old msm-free.db, or the upstream-MSM-compatible
	// msm.db): open the existing database in place. File-level migration to the
	// msf.db name is performed by the Phase 3 installer before the server starts.
	for _, legacyName := range []string{"msm.db", "msm-free.db"} {
		legacy := filepath.Join(dbDir, legacyName)
		if _, err := os.Stat(legacy); err == nil {
			return legacy
		}
	}
	return preferred
}

func MigrateLegacyLayout(dataDir string) error {
	if dataDir == "" {
		return fmt.Errorf("data dir is required")
	}
	if err := migrateLegacyDatabaseFiles(dataDir); err != nil {
		return err
	}
	if err := migrateLegacyManualProvider(dataDir); err != nil {
		return err
	}
	if err := migrateLegacyTextReferences(dataDir); err != nil {
		return err
	}
	nftPath := filepath.Join(dataDir, "configs/network/network.nft")
	if _, err := os.Stat(nftPath); err == nil {
		if err := sanitizeNFTConfigFile(nftPath); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := migrateLegacyLogFiles(dataDir); err != nil {
		return err
	}
	cleanupLegacyRuntimeFiles(dataDir)
	cleanupLegacyNFTTable()
	return nil
}

func migrateLegacyDatabaseFiles(dataDir string) error {
	dbDir := filepath.Join(dataDir, "database")
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return err
	}
	preferred := filepath.Join(dbDir, "msf.db")
	if _, err := os.Stat(preferred); err == nil {
		return nil
	}
	for _, legacyName := range []string{"msm.db", "msm-free.db"} {
		legacy := filepath.Join(dbDir, legacyName)
		if _, err := os.Lstat(legacy); err != nil {
			continue
		}
		if err := moveLegacyFile(legacy, preferred); err != nil {
			return err
		}
		for _, suffix := range []string{"-wal", "-shm"} {
			if err := moveLegacyFile(legacy+suffix, preferred+suffix); err != nil {
				return err
			}
		}
		return nil
	}
	return nil
}

func migrateLegacyManualProvider(dataDir string) error {
	oldProvider := filepath.Join(dataDir, "configs/mihomo/proxy_providers/msm_manual.yaml")
	newProvider := filepath.Join(dataDir, "configs/mihomo/proxy_providers/msf_manual.yaml")
	if _, err := os.Lstat(oldProvider); err == nil {
		if err := moveLegacyFile(oldProvider, newProvider); err != nil {
			return err
		}
	}
	for _, rel := range []string{
		"configs/mihomo/config.yaml",
		"configs/mihomo/config.yaml.backup",
		"configs/mihomo/user_configs",
	} {
		path := filepath.Join(dataDir, rel)
		if err := replaceLegacyManualReferences(path); err != nil {
			return err
		}
	}
	return nil
}

func replaceLegacyManualReferences(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	if info.IsDir() {
		return filepath.WalkDir(path, func(item string, d os.DirEntry, walkErr error) error {
			if walkErr != nil || d.IsDir() {
				return walkErr
			}
			switch strings.ToLower(filepath.Ext(item)) {
			case ".yaml", ".yml", ".json", ".txt":
				return replaceLegacyManualReferences(item)
			default:
				return nil
			}
		})
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	text := string(b)
	replaced := strings.ReplaceAll(text, "msm_manual.yaml", "msf_manual.yaml")
	replaced = strings.ReplaceAll(replaced, "msm_manual:", "msf_manual:")
	replaced = strings.ReplaceAll(replaced, "msm_manual", "msf_manual")
	if replaced == text {
		return nil
	}
	return os.WriteFile(path, []byte(replaced), info.Mode())
}

func migrateLegacyTextReferences(dataDir string) error {
	replacements := []struct {
		old string
		new string
	}{
		{"/opt/msm-free", dataDir},
		{"table inet msm_free", "table inet msf"},
		{"msm_free", "msf"},
		{"msm_manual.yaml", "msf_manual.yaml"},
		{"msm_manual:", "msf_manual:"},
		{"msm_manual", "msf_manual"},
		{"msm-free-zashboard-disk-backend", "msf-zashboard-disk-backend"},
		{"msm-free", "msf"},
		{"msm.log", "msf.log"},
	}
	for _, rel := range []string{"configs"} {
		root := filepath.Join(dataDir, rel)
		if err := filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
			if walkErr != nil || d.IsDir() {
				return walkErr
			}
			if !legacyTextFile(path) {
				return nil
			}
			return replaceTextFile(path, replacements)
		}); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func legacyTextFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".conf", ".ini", ".nft", ".yaml", ".yml", ".json", ".txt", ".log", ".html", ".js", ".css", ".webmanifest":
		return true
	default:
		return false
	}
}

func replaceTextFile(path string, replacements []struct {
	old string
	new string
}) error {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	text := string(b)
	replaced := text
	for _, pair := range replacements {
		replaced = strings.ReplaceAll(replaced, pair.old, pair.new)
	}
	if replaced == text {
		return nil
	}
	return os.WriteFile(path, []byte(replaced), info.Mode())
}

func migrateLegacyLogFiles(dataDir string) error {
	for _, pair := range [][2]string{
		{"logs/msm.log", "logs/msf.log"},
		{"logs/msm-free.log", "logs/msf.log"},
		{"logs/msm.cli.log", "logs/msf.cli.log"},
		{"logs/msm-free.cli.log", "logs/msf.cli.log"},
		{"logs/msm.unraid.log", "logs/msf.unraid.log"},
		{"logs/msm-free.unraid.log", "logs/msf.unraid.log"},
	} {
		if err := moveLegacyFile(filepath.Join(dataDir, pair[0]), filepath.Join(dataDir, pair[1])); err != nil {
			return err
		}
	}
	return nil
}

func cleanupLegacyRuntimeFiles(dataDir string) {
	for _, rel := range []string{"msm.pid", "msm-free.pid"} {
		_ = os.Remove(filepath.Join(dataDir, rel))
	}
}

func cleanupLegacyNFTTable() {
	if os.Geteuid() != 0 {
		return
	}
	if _, err := exec.LookPath("nft"); err != nil {
		return
	}
	_ = exec.Command("nft", "delete", "table", "inet", "msm_free").Run()
}

func moveLegacyFile(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return nil
	}
	if _, err := os.Stat(dst); err == nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink == 0 {
		if err := os.Rename(src, dst); err == nil {
			return nil
		}
	}
	if err := copyFileFollowingSymlink(src, dst, info.Mode().Perm()); err != nil {
		return err
	}
	return os.Remove(src)
}

func copyFileFollowingSymlink(src, dst string, perm os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, perm)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func (a *App) ensureCompatibilityLayout() error {
	if err := a.ensureCompatibilityDatabaseLink(); err != nil {
		return err
	}
	for rel, content := range map[string]string{
		"configs/supervisor/supervisord.conf":    a.renderSupervisorConf(),
		"configs/supervisor/services/mihomo.ini": a.renderSupervisorService("mihomo"),
		"configs/supervisor/services/mosdns.ini": a.renderSupervisorService("mosdns"),
	} {
		path := filepath.Join(a.DataDir, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			return err
		}
	}
	files := map[string]string{
		"logs/supervisor/supervisord.log":      "",
		"logs/msf.log":                         "",
		"configs/logs/mosdns.log":              "",
		"configs/mosdns/cache/.keep":           "",
		"configs/mosdns/unpack/.keep":          "",
		"configs/network/history/.keep":        "",
		"data/binaries/supervisord/.keep":      "",
		"configs/mihomo/proxy_providers/.keep": "",
		"configs/mihomo/user_configs/.keep":    "",
		"configs/mihomo/ui/.keep":              "",
		"configs/mosdns/adguard/.keep":         "",
		"configs/mosdns/gen/.keep":             "",
		"configs/mosdns/genblank/.keep":        "",
		"configs/mosdns/srs/.keep":             "",
		"configs/mosdns/webinfo/.keep":         "",
		"configs/mosdns/sub_config/.keep":      "",
		"configs/mosdns/rule/.keep":            "",
	}
	for rel, content := range files {
		path := filepath.Join(a.DataDir, rel)
		if _, err := os.Stat(path); err == nil {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			return err
		}
	}
	configPath := filepath.Join(a.DataDir, "configs/mihomo/config.yaml")
	backupPath := filepath.Join(a.DataDir, "configs/mihomo/config.yaml.backup")
	if _, err := os.Stat(backupPath); os.IsNotExist(err) {
		if b, readErr := os.ReadFile(configPath); readErr == nil {
			if err := os.WriteFile(backupPath, b, 0644); err != nil {
				return err
			}
		}
	}
	return nil
}

func (a *App) ensureCompatibilityDatabaseLink() error {
	// Historically this linked msm.db <-> msm-free.db for drop-in upstream-MSM
	// compatibility. After the msf rename there is a single canonical database
	// name (msf.db); a pre-rename database is opened in place by databasePath and
	// migrated to msf.db by the Phase 3 installer before the server starts.
	return nil
}

func (a *App) renderSupervisorConf() string {
	return fmt.Sprintf(`[unix_http_server]
file=%s

[supervisord]
logfile=%s
pidfile=%s
nodaemon=false

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix://%s

[include]
files = %s
`, filepath.Join(a.DataDir, "configs/supervisor/supervisor.sock"),
		filepath.Join(a.DataDir, "logs/supervisor/supervisord.log"),
		filepath.Join(a.DataDir, "data/supervisord.pid"),
		filepath.Join(a.DataDir, "configs/supervisor/supervisor.sock"),
		filepath.Join(a.DataDir, "configs/supervisor/services/*.ini"))
}

func (a *App) renderSupervisorService(name string) string {
	switch name {
	case "mihomo":
		return fmt.Sprintf(`[program:mihomo]
command=%s -d %s -f %s
directory=%s
autostart=false
autorestart=true
stdout_logfile=%s
stderr_logfile=%s
`, filepath.Join(a.DataDir, "data/binaries/mihomo/mihomo"),
			filepath.Join(a.DataDir, "configs/mihomo"),
			filepath.Join(a.DataDir, "configs/mihomo/config.yaml"),
			filepath.Join(a.DataDir, "configs/mihomo"),
			filepath.Join(a.DataDir, "logs/mihomo.out.log"),
			filepath.Join(a.DataDir, "logs/mihomo.err.log"))
	default:
		return fmt.Sprintf(`[program:mosdns]
command=%s start --dir %s
directory=%s
autostart=false
autorestart=true
stdout_logfile=%s
stderr_logfile=%s
`, filepath.Join(a.DataDir, "data/binaries/mosdns/mosdns"),
			filepath.Join(a.DataDir, "configs/mosdns"),
			filepath.Join(a.DataDir, "configs/mosdns"),
			filepath.Join(a.DataDir, "logs/mosdns.out.log"),
			filepath.Join(a.DataDir, "logs/mosdns.err.log"))
	}
}
