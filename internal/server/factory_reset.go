package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/scoltzero/msf/internal/cloudflareredirect"
)

const (
	factoryResetMarkerName     = ".factory-reset-in-progress.json"
	factoryResetCompletionKey  = "factory_reset.completed_id"
	factoryResetPhaseStaging   = "staging"
	factoryResetPhaseStaged    = "staged"
	factoryResetPhaseCommit    = "commit_pending"
	factoryResetPhaseCommitted = "committed"
)

type factoryResetOptions struct {
	DeleteComponents bool
}

type factoryResetResult struct {
	FactoryReset         bool     `json:"factory_reset"`
	RequiresReinitialize bool     `json:"requires_reinitialize"`
	DeletedComponents    []string `json:"deleted_components"`
	RetainedComponents   []string `json:"retained_components"`
}

type factoryResetState struct {
	ResetID          string   `json:"reset_id"`
	Phase            string   `json:"phase"`
	TrashRel         string   `json:"trash_rel"`
	RetainedUIRel    string   `json:"retained_ui_rel,omitempty"`
	Staged           []string `json:"staged,omitempty"`
	DeleteComponents bool     `json:"delete_components"`
	CreatedAt        int64    `json:"created_at_unix_nano"`
}

type factoryResetRuntimeSnapshot struct {
	Config         SetupConfig
	HasConfig      bool
	RestoreNFT     bool
	ServiceRunning map[string]bool
	ServiceDesired map[string]bool
}

var (
	factoryResetStopManagedServices = func(a *App, ctx context.Context) error {
		return a.Services.StopAll(ctx)
	}
	factoryResetClearNetworkState = func(a *App, ctx context.Context) error {
		_, err := a.clearNFT(ctx)
		return err
	}
	factoryResetBuildBaseLayout = func(a *App, secret string, state factoryResetState) error {
		return a.createFactoryResetBaseLayout(secret, state)
	}
	factoryResetRestoreRuntime = func(a *App, snapshot factoryResetRuntimeSnapshot) error {
		return a.restoreFactoryResetRuntime(snapshot)
	}
)

func recoverIncompleteFactoryReset(dataDir string) error {
	marker := filepath.Join(dataDir, factoryResetMarkerName)
	body, err := os.ReadFile(marker)
	if os.IsNotExist(err) {
		_ = os.Remove(marker + ".tmp")
		return nil
	}
	if err != nil {
		return err
	}
	var state factoryResetState
	if err := json.Unmarshal(body, &state); err != nil {
		return fmt.Errorf("decode factory reset marker: %w", err)
	}
	if err := validateFactoryResetState(state); err != nil {
		return err
	}
	committed := state.Phase == factoryResetPhaseCommitted || state.Phase == "database_reset"
	if !committed && state.Phase == factoryResetPhaseCommit && state.ResetID != "" {
		committed, err = factoryResetDatabaseCommitted(dataDir, state.ResetID)
		if err != nil {
			return err
		}
	}
	if committed {
		return finishRecoveredFactoryReset(dataDir, state)
	}
	return rollbackFactoryResetState(dataDir, state)
}

func validateFactoryResetState(state factoryResetState) error {
	if state.ResetID == "" {
		return errors.New("factory reset marker is missing reset_id")
	}
	if !validFactoryResetInternalPath(state.TrashRel, ".factory-reset-trash-") {
		return fmt.Errorf("factory reset marker has invalid trash path %q", state.TrashRel)
	}
	if state.RetainedUIRel != "" && !validFactoryResetInternalPath(state.RetainedUIRel, ".factory-reset-retained-ui-") {
		return fmt.Errorf("factory reset marker has invalid retained UI path %q", state.RetainedUIRel)
	}
	for _, rel := range state.Staged {
		clean := filepath.Clean(filepath.FromSlash(rel))
		if clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return fmt.Errorf("factory reset marker has unsafe staged path %q", rel)
		}
	}
	return nil
}

func validFactoryResetInternalPath(rel, prefix string) bool {
	return rel != "" && filepath.Base(rel) == rel && strings.HasPrefix(rel, prefix) && len(rel) > len(prefix)
}

func factoryResetDatabaseCommitted(dataDir, resetID string) (bool, error) {
	path := databasePath(dataDir)
	if !fileExists(path) {
		return false, nil
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return false, err
	}
	defer db.Close()
	var value string
	err = db.QueryRow(`select value from settings where key=?`, factoryResetCompletionKey).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) || strings.Contains(strings.ToLower(fmt.Sprint(err)), "no such table") {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("inspect factory reset database state: %w", err)
	}
	return value == resetID, nil
}

func finishRecoveredFactoryReset(dataDir string, state factoryResetState) error {
	if err := os.RemoveAll(filepath.Join(dataDir, filepath.FromSlash(state.TrashRel))); err != nil {
		return err
	}
	if state.RetainedUIRel != "" {
		if err := os.RemoveAll(filepath.Join(dataDir, filepath.FromSlash(state.RetainedUIRel))); err != nil {
			return err
		}
	}
	if err := os.Remove(filepath.Join(dataDir, factoryResetMarkerName)); err != nil && !os.IsNotExist(err) {
		return err
	}
	_ = os.Remove(filepath.Join(dataDir, factoryResetMarkerName) + ".tmp")
	return nil
}

func rollbackFactoryResetState(dataDir string, state factoryResetState) error {
	trash := filepath.Join(dataDir, filepath.FromSlash(state.TrashRel))
	for i := len(state.Staged) - 1; i >= 0; i-- {
		rel := state.Staged[i]
		src := filepath.Join(trash, filepath.FromSlash(rel))
		dst := filepath.Join(dataDir, filepath.FromSlash(rel))
		if !fileExists(src) {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		if err := os.RemoveAll(dst); err != nil {
			return err
		}
		if err := os.Rename(src, dst); err != nil {
			return fmt.Errorf("restore staged factory reset path %s: %w", rel, err)
		}
	}
	if state.RetainedUIRel != "" {
		retained := filepath.Join(dataDir, filepath.FromSlash(state.RetainedUIRel))
		if fileExists(retained) {
			dest := filepath.Join(dataDir, "configs/mihomo/ui")
			if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
				return err
			}
			if err := os.RemoveAll(dest); err != nil {
				return err
			}
			if err := os.Rename(retained, dest); err != nil {
				return fmt.Errorf("restore retained zashboard UI: %w", err)
			}
		}
	}
	if err := os.RemoveAll(trash); err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(dataDir, factoryResetMarkerName)); err != nil && !os.IsNotExist(err) {
		return err
	}
	_ = os.Remove(filepath.Join(dataDir, factoryResetMarkerName) + ".tmp")
	return nil
}

func (a *App) factoryReset(ctx context.Context, opts factoryResetOptions) (result factoryResetResult, returnErr error) {
	runtimeSnapshot := a.captureFactoryResetRuntime()
	defer func() {
		if returnErr == nil {
			return
		}
		if err := factoryResetRestoreRuntime(a, runtimeSnapshot); err != nil {
			returnErr = errors.Join(returnErr, fmt.Errorf("restore runtime after failed factory reset: %w", err))
		}
	}()

	result = factoryResetResult{
		FactoryReset:         true,
		RequiresReinitialize: true,
		DeletedComponents:    []string{},
		RetainedComponents:   []string{},
	}
	installed := a.installedFactoryResetComponents()
	if opts.DeleteComponents {
		result.DeletedComponents = installed
	} else {
		result.RetainedComponents = installed
	}

	if err := factoryResetStopManagedServices(a, ctx); err != nil {
		return factoryResetResult{}, fmt.Errorf("stop managed services: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return factoryResetResult{}, fmt.Errorf("factory reset canceled after stopping services: %w", err)
	}
	if runtime.GOOS == "linux" {
		if err := factoryResetClearNetworkState(a, ctx); err != nil {
			return factoryResetResult{}, fmt.Errorf("clear nftables and policy routing: %w", err)
		}
	}
	if err := ctx.Err(); err != nil {
		return factoryResetResult{}, fmt.Errorf("factory reset canceled after network cleanup: %w", err)
	}

	state, err := a.stageFactoryResetFiles(opts.DeleteComponents)
	if err != nil {
		return factoryResetResult{}, err
	}
	committed := false
	defer func() {
		if !committed {
			if err := a.rollbackFactoryResetFiles(state); err != nil {
				returnErr = errors.Join(returnErr, fmt.Errorf("rollback factory reset files: %w", err))
			}
		}
	}()

	tx, secret, err := a.prepareFactoryResetDatabase(state.ResetID)
	if err != nil {
		return factoryResetResult{}, err
	}
	txCommitted := false
	defer func() {
		if txCommitted {
			return
		}
		if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
			returnErr = errors.Join(returnErr, fmt.Errorf("rollback factory reset database: %w", err))
		}
	}()
	if err := factoryResetBuildBaseLayout(a, secret, state); err != nil {
		return factoryResetResult{}, err
	}
	state.Phase = factoryResetPhaseCommit
	if err := a.writeFactoryResetMarker(state); err != nil {
		return factoryResetResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return factoryResetResult{}, fmt.Errorf("commit factory reset database: %w", err)
	}
	txCommitted = true
	committed = true
	a.setSecret([]byte(secret))
	a.clearFactoryResetCaches()

	state.Phase = factoryResetPhaseCommitted
	if err := a.writeFactoryResetMarker(state); err != nil {
		log.Printf("factory reset committed but marker update failed: %v", err)
	}
	if err := a.finishFactoryResetFiles(state); err != nil {
		log.Printf("factory reset committed but deferred cleanup is required: %v", err)
	} else {
		_, _ = a.DB.Exec(`delete from settings where key=?`, factoryResetCompletionKey)
	}
	return result, nil
}

func (a *App) captureFactoryResetRuntime() factoryResetRuntimeSnapshot {
	snapshot := factoryResetRuntimeSnapshot{
		ServiceRunning: map[string]bool{},
		ServiceDesired: map[string]bool{},
	}
	for _, name := range managedServiceNames() {
		snapshot.ServiceRunning[name] = a.Services.Status(name).Running
		snapshot.ServiceDesired[name] = a.setting(serviceDesiredKey(name), "false") == "true"
	}
	if cfg, ok := a.latestSetupConfig(); ok {
		cfg.defaults()
		snapshot.Config = cfg
		snapshot.HasConfig = true
		snapshot.RestoreNFT = shouldRestoreNFT(cfg) && a.setting(nftDesiredKey, "false") == "true"
	}
	return snapshot
}

func (a *App) restoreFactoryResetRuntime(snapshot factoryResetRuntimeSnapshot) error {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	var restoreErrors []error
	for _, name := range managedServiceNames() {
		if snapshot.ServiceRunning[name] && !a.Services.Status(name).Running {
			if _, err := a.Services.Start(ctx, name); err != nil {
				restoreErrors = append(restoreErrors, fmt.Errorf("restart %s: %w", name, err))
			}
		}
		a.Services.setDesired(name, snapshot.ServiceDesired[name])
	}
	if runtime.GOOS == "linux" && snapshot.RestoreNFT {
		if _, err := a.applyNFT(ctx); err != nil {
			restoreErrors = append(restoreErrors, fmt.Errorf("restore nftables and policy routing: %w", err))
		}
	}
	return errors.Join(restoreErrors...)
}

func (a *App) validateFactoryResetPassword(user *User, password string) error {
	if user == nil || user.ID == 0 {
		return errors.New("admin identity is required")
	}
	password = strings.TrimSpace(password)
	if password == "" {
		return errors.New("current password is required")
	}
	var hash string
	if err := a.DB.QueryRow(`select password from users where id=? and is_active=true and deleted_at is null`, user.ID).Scan(&hash); err != nil {
		return errors.New("current password is invalid")
	}
	if !passwordMatches(hash, password) {
		return errors.New("current password is invalid")
	}
	return nil
}

func (a *App) installedFactoryResetComponents() []string {
	installed := []string{}
	for _, component := range []string{"mosdns", "mihomo"} {
		if a.Services.Status(component).Installed {
			installed = append(installed, component)
		}
	}
	if fileExists(a.componentTarget("zashboard")) {
		installed = append(installed, "zashboard")
	}
	sort.Strings(installed)
	return installed
}

func (a *App) stageFactoryResetFiles(deleteComponents bool) (state factoryResetState, returnErr error) {
	stamp := fmt.Sprintf("%d-%s", time.Now().UnixNano(), randomHex(4))
	state = factoryResetState{
		ResetID:          stamp,
		Phase:            factoryResetPhaseStaging,
		TrashRel:         ".factory-reset-trash-" + stamp,
		DeleteComponents: deleteComponents,
		CreatedAt:        time.Now().UnixNano(),
	}
	trash := filepath.Join(a.DataDir, state.TrashRel)
	if !deleteComponents && fileExists(filepath.Join(a.DataDir, "configs/mihomo/ui")) {
		state.RetainedUIRel = ".factory-reset-retained-ui-" + stamp
	}
	if err := a.writeFactoryResetMarker(state); err != nil {
		return state, err
	}
	if err := os.MkdirAll(trash, 0o700); err != nil {
		_ = os.Remove(filepath.Join(a.DataDir, factoryResetMarkerName))
		return state, err
	}
	defer func() {
		if returnErr != nil {
			if err := a.rollbackFactoryResetFiles(state); err != nil {
				returnErr = errors.Join(returnErr, fmt.Errorf("rollback staged factory reset files: %w", err))
			}
		}
	}()

	if state.RetainedUIRel != "" {
		ui := filepath.Join(a.DataDir, "configs/mihomo/ui")
		retained := filepath.Join(a.DataDir, state.RetainedUIRel)
		if err := os.Rename(ui, retained); err != nil {
			return state, fmt.Errorf("retain zashboard UI: %w", err)
		}
	}

	paths := []string{"configs", "backups", "logs", "msf.log"}
	dataDir := filepath.Join(a.DataDir, "data")
	if entries, err := os.ReadDir(dataDir); err == nil {
		for _, entry := range entries {
			if entry.Name() == "binaries" && !deleteComponents {
				continue
			}
			paths = append(paths, filepath.ToSlash(filepath.Join("data", entry.Name())))
		}
	} else if !os.IsNotExist(err) {
		return state, err
	}
	for _, rel := range paths {
		src := filepath.Join(a.DataDir, filepath.FromSlash(rel))
		if !fileExists(src) {
			continue
		}
		dst := filepath.Join(trash, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
			return state, err
		}
		state.Staged = append(state.Staged, rel)
		if err := a.writeFactoryResetMarker(state); err != nil {
			return state, err
		}
		if err := os.Rename(src, dst); err != nil {
			return state, fmt.Errorf("stage factory reset path %s: %w", rel, err)
		}
	}
	state.Phase = factoryResetPhaseStaged
	if err := a.writeFactoryResetMarker(state); err != nil {
		return state, err
	}
	return state, nil
}

func (a *App) prepareFactoryResetDatabase(resetID string) (*sql.Tx, string, error) {
	tx, err := a.DB.Begin()
	if err != nil {
		return nil, "", err
	}
	fail := func(err error) (*sql.Tx, string, error) {
		_ = tx.Rollback()
		return nil, "", err
	}
	if _, err := tx.Exec(`pragma secure_delete=ON`); err != nil {
		return fail(err)
	}
	rows, err := tx.Query(`select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name`)
	if err != nil {
		return fail(err)
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			_ = rows.Close()
			return fail(err)
		}
		tables = append(tables, name)
	}
	if err := rows.Close(); err != nil {
		return fail(err)
	}
	for _, table := range tables {
		quoted := `"` + strings.ReplaceAll(table, `"`, `""`) + `"`
		if _, err := tx.Exec(`delete from ` + quoted); err != nil {
			return fail(fmt.Errorf("clear %s: %w", table, err))
		}
	}
	_, _ = tx.Exec(`delete from sqlite_sequence`)
	secret := randomHex(48)
	now := time.Now()
	if _, err := tx.Exec(`insert into settings(key,value,updated_at) values('jwt_secret',?,?)`, secret, now); err != nil {
		return fail(err)
	}
	if _, err := tx.Exec(`insert into settings(key,value,updated_at) values(?,?,?)`, factoryResetCompletionKey, resetID, now); err != nil {
		return fail(err)
	}
	for key, enabled := range defaultMosDNSSwitchStates() {
		if _, err := tx.Exec(`insert into mosdns_switch_states(switch_key,enabled,created_at,updated_at) values(?,?,?,?)`, key, enabled, now, now); err != nil {
			return fail(err)
		}
	}
	if _, err := tx.Exec(`insert into update_info(component,current_version,latest_version,has_update,status,phase,progress,message,event_log,error_message,download_url,release_notes,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		"msf", a.Version, a.Version, false, "idle", "idle", 0, "", "[]", "", "", "", now, now); err != nil {
		return fail(err)
	}
	return tx, secret, nil
}

func (a *App) createFactoryResetBaseLayout(secret string, state factoryResetState) error {
	dirs := []string{
		"configs/logs", "configs/mosdns/sub_config", "configs/mosdns/rules", "configs/mosdns/webinfo",
		"configs/mosdns/cache", "configs/mosdns/gen", "configs/mosdns/genblank", "configs/mosdns/rule",
		"configs/mosdns/srs", "configs/mosdns/unpack", "configs/mihomo/rules", "configs/mihomo/proxy_providers",
		"configs/mihomo/user_configs", "configs/mihomo/ui", "configs/network", "configs/network/history",
		"configs/singbox", "configs/supervisor/services", "data/binaries/mosdns", "data/binaries/mihomo",
		"data/binaries/supervisord", "data/binaries/zashboard", "logs/supervisor", "database", "backups",
	}
	for _, rel := range dirs {
		if err := os.MkdirAll(filepath.Join(a.DataDir, filepath.FromSlash(rel)), 0o755); err != nil {
			return fmt.Errorf("create factory reset directory %s: %w", rel, err)
		}
	}
	if err := a.ensureMSSBTemplateDefaults(false); err != nil {
		return err
	}
	cfg := SetupConfig{
		Timezone:          "Asia/Shanghai",
		WebPort:           "7777",
		SelectedInterface: "eth0",
		MihomoCoreType:    "meta",
		AutoSetDNS:        true,
		EnableIPv6:        true,
		ProxyCore:         "mihomo",
		MosDNSEnabled:     true,
	}
	cfg.defaults()
	files := map[string]string{
		"configs/app.yaml":                  a.renderAppYAMLWithSecret(cfg, []byte(secret)),
		"configs/mosdns/config.yaml":        a.renderMosDNSYAML(cfg),
		"configs/mosdns/client_ip.txt":      "",
		"configs/mosdns/rule/blocklist.txt": "",
		"configs/network/network.yaml":      a.renderNetworkYAML(cfg),
		"configs/singbox/config.json":       renderDisabledSingBoxJSON(),
		"configs/mihomo/config.yaml":        a.renderMihomoYAML(cfg),
	}
	if shouldRestoreNFT(cfg) {
		files["configs/network/network.nft"] = a.renderNFT(cfg)
	}
	for rel, content := range files {
		path := filepath.Join(a.DataDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			return fmt.Errorf("write factory reset file %s: %w", rel, err)
		}
	}
	if factoryResetStateContainsPath(state, "msf.log") {
		if err := os.WriteFile(filepath.Join(a.DataDir, "msf.log"), nil, 0o644); err != nil {
			return fmt.Errorf("recreate fnOS wrapper log: %w", err)
		}
	}
	if err := cloudflareredirect.EnsureDefaultConfig(a.DataDir); err != nil {
		return err
	}
	if err := a.ensureCompatibilityLayout(); err != nil {
		return err
	}
	if state.RetainedUIRel != "" {
		src := filepath.Join(a.DataDir, filepath.FromSlash(state.RetainedUIRel))
		dst := filepath.Join(a.DataDir, "configs/mihomo/ui")
		if fileExists(src) {
			if err := os.RemoveAll(dst); err != nil {
				return err
			}
			if err := copyFactoryResetTree(src, dst); err != nil {
				return fmt.Errorf("restore retained zashboard UI into reset layout: %w", err)
			}
		}
	}
	if err := a.validateGeneratedProxyModeFiles(cfg); err != nil {
		return fmt.Errorf("validate factory reset base configuration: %w", err)
	}
	return nil
}

func factoryResetStateContainsPath(state factoryResetState, want string) bool {
	for _, rel := range state.Staged {
		if rel == want {
			return true
		}
	}
	return false
}

func copyFactoryResetTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(target, info.Mode().Perm())
		}
		if entry.Type()&os.ModeSymlink != 0 {
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			return os.Symlink(link, target)
		}
		return copyFile(path, target, info.Mode().Perm())
	})
}

func (a *App) writeFactoryResetMarker(state factoryResetState) error {
	body, err := json.Marshal(state)
	if err != nil {
		return err
	}
	marker := filepath.Join(a.DataDir, factoryResetMarkerName)
	tmp := marker + ".tmp"
	if err := os.WriteFile(tmp, body, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, marker)
}

func (a *App) rollbackFactoryResetFiles(state factoryResetState) error {
	return rollbackFactoryResetState(a.DataDir, state)
}

func (a *App) finishFactoryResetFiles(state factoryResetState) error {
	return finishRecoveredFactoryReset(a.DataDir, state)
}

func (a *App) clearFactoryResetCaches() {
	a.monitorMu.Lock()
	a.monitorNetworkLast = monitorNetworkSample{}
	a.monitorMu.Unlock()
	a.mihomoTrafficMu.Lock()
	a.mihomoTrafficCache = nil
	a.mihomoTrafficAt = time.Time{}
	a.mihomoTrafficMu.Unlock()
}
