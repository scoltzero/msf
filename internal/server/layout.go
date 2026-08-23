package server

import (
	"fmt"
	"os"
	"path/filepath"
)

func databasePath(dataDir string) string {
	return filepath.Join(dataDir, "database", "msf.db")
}

func (a *App) ensureRuntimeLayout() error {
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
