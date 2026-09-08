package server

import (
	"database/sql"
	"errors"
	"os"
	"strings"
)

// The Mihomo external controller used to listen on :9090 with no secret,
// exposing node switching, mode changes and the full connection list
// (browsing history) to any LAN device (KNOWN_ISSUES ①).  MSF now generates
// a random secret on first run, writes it into the active config, and uses
// it for its own controller calls (mihomoSecret already prefers this
// setting).  Clearing the setting opts back out of controller auth.
const mihomoControllerSecretSettingKey = "mihomo_controller_secret"

// The secret is cached in memory: renderMihomoYAML runs inside code paths
// (factory reset, config apply) that may already hold the single sqlite
// connection, so the injection path must never issue its own DB query.
func (a *App) setCachedMihomoControllerSecret(value string) {
	a.mihomoSecretValueMu.Lock()
	a.mihomoSecretValue = value
	a.mihomoSecretValueMu.Unlock()
}

func (a *App) cachedMihomoControllerSecret() string {
	a.mihomoSecretValueMu.RLock()
	defer a.mihomoSecretValueMu.RUnlock()
	return a.mihomoSecretValue
}

// ensureMihomoControllerSecret generates the secret once.  A present-but-empty
// value means the operator deliberately disabled controller auth and is kept.
func (a *App) ensureMihomoControllerSecret() {
	var existing string
	err := a.DB.QueryRow(`select value from settings where key=?`, mihomoControllerSecretSettingKey).Scan(&existing)
	if err == nil {
		a.setCachedMihomoControllerSecret(strings.TrimSpace(existing))
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return
	}
	value := randomHex(24)
	a.setSetting(mihomoControllerSecretSettingKey, value)
	a.setCachedMihomoControllerSecret(value)
}

func (a *App) mihomoControllerSecret() string {
	return a.cachedMihomoControllerSecret()
}

// injectMihomoControllerSecret adds the `secret:` line to a config body that
// does not carry one of its own.  User-provided secrets always win; the line
// is placed directly under external-controller to keep related fields
// together in the generated layout.
func (a *App) injectMihomoControllerSecret(content string) string {
	secret := a.mihomoControllerSecret()
	if secret == "" || mihomoConfigHasSecret(content) {
		return content
	}
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "external-controller:") {
			updated := make([]string, 0, len(lines)+1)
			updated = append(updated, lines[:i+1]...)
			updated = append(updated, "secret: "+secret)
			updated = append(updated, lines[i+1:]...)
			return strings.Join(updated, "\n")
		}
	}
	return "secret: " + secret + "\n" + content
}

func mihomoConfigHasSecret(content string) bool {
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "secret:") {
			return true
		}
	}
	return false
}

// ensureActiveMihomoControllerSecret backfills the secret into an existing
// active config (deployments created before this hardening).  The file is
// only rewritten when a line is actually missing.
func (a *App) ensureActiveMihomoControllerSecret() {
	path, err := a.safePath(mihomoActiveConfigRelPath)
	if err != nil {
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	content := string(raw)
	updated := a.injectMihomoControllerSecret(content)
	if updated == content {
		return
	}
	_ = a.writeTextFileDirect(mihomoActiveConfigRelPath, updated)
	a.LogInfo("server/mihomo_controller_secret.go", "已为 mihomo 控制器生成随机 secret 并写入配置（9090 API 不再无认证开放，zashboard 需输入一次 secret）", map[string]any{
		"config": mihomoActiveConfigRelPath,
	})
}
