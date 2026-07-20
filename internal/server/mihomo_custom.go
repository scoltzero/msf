package server

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	mihomoConfigModeKey           = "mihomo.config_mode"
	mihomoGeneratedBackupPathKey  = "mihomo.generated_backup_path"
	mihomoGeneratedBackupRelPath  = "configs/mihomo/msf_generated.backup.yaml"
	mihomoActiveConfigRelPath     = "configs/mihomo/config.yaml"
	mihomoUserConfigsRelDir       = "configs/mihomo/user_configs"
	mihomoAppliedUserConfigKey    = "mihomo.applied_user_config"
	maxMihomoConfigUploadFileSize = 8 << 20
)

type mihomoConfigValidation struct {
	Valid    bool     `json:"valid"`
	Error    string   `json:"error,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
}

func (a *App) handleMihomoConfigMode(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": a.mihomoConfigModePayload()})
}

func (a *App) handleMihomoCustomTemplate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"content":          a.mihomoCustomTemplateContent(),
			"protected_fields": a.mihomoProtectedFields(),
			"mode":             a.mihomoConfigMode(),
			"suggested_name":   a.nextMihomoUserConfigName(),
		},
	})
}

func (a *App) handleMihomoConfigImport(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxMihomoConfigUploadFileSize); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "file is required")
		return
	}
	defer file.Close()
	name := strings.ToLower(filepath.Base(header.Filename))
	if !strings.HasSuffix(name, ".yaml") && !strings.HasSuffix(name, ".yml") {
		writeError(w, http.StatusBadRequest, "bad_request", "only .yaml/.yml config files are supported")
		return
	}
	body, err := io.ReadAll(io.LimitReader(file, maxMihomoConfigUploadFileSize+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "read_failed", err.Error())
		return
	}
	if len(body) > maxMihomoConfigUploadFileSize {
		writeError(w, http.StatusBadRequest, "too_large", "config file is too large")
		return
	}
	nameValue := strings.TrimSpace(r.FormValue("name"))
	if nameValue == "" {
		nameValue = header.Filename
		if _, err := normalizeMihomoUserConfigName(nameValue); err != nil {
			nameValue = a.nextMihomoUserConfigName()
		}
	}
	overwrite := isTruthy(r.FormValue("overwrite"))
	item, validation, err := a.saveMihomoUserConfig(nameValue, string(body), overwrite, currentUsername(r))
	if err != nil {
		if strings.Contains(err.Error(), "already exists") {
			writeError(w, http.StatusConflict, "config_exists", err.Error())
			return
		}
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	if !validation.Valid {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": validation.Error, "data": validation})
		return
	}
	if isTruthy(r.FormValue("apply")) {
		if _, err := a.applyMihomoUserConfig(r.Context(), item["path"].(string), !strings.EqualFold(r.FormValue("restart"), "false"), currentUsername(r)); err != nil {
			writeError(w, http.StatusBadRequest, "apply_failed", err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"config":     item,
			"validation": validation,
			"mode":       a.mihomoConfigModePayload(),
		},
	})
}

func (a *App) handleMihomoConfigRestoreDefault(w http.ResponseWriter, r *http.Request) {
	content, restoredFrom, err := a.defaultMihomoConfigForRestore()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "restore_failed", err.Error())
		return
	}
	if err := a.replaceGeneratedConfigFiles(map[string]string{mihomoActiveConfigRelPath: content}, nil); err != nil {
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	a.setMihomoConfigMode("generated")
	a.setSetting(mihomoAppliedUserConfigKey, "")
	restarted := false
	if !strings.EqualFold(r.URL.Query().Get("restart"), "false") {
		_, _ = a.Services.Restart(r.Context(), "mihomo")
		restarted = true
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"mode":          a.mihomoConfigModePayload(),
			"restored_from": restoredFrom,
			"restarted":     restarted,
			"path":          mihomoActiveConfigRelPath,
		},
	})
}

func (a *App) handleMihomoUserConfigs(w http.ResponseWriter, r *http.Request) {
	items := a.mihomoUserConfigItems()
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"items":          items,
			"files":          items,
			"suggested_name": a.nextMihomoUserConfigName(),
			"active_path":    a.setting(mihomoAppliedUserConfigKey, ""),
		},
		"files":   items,
		"configs": items,
	})
}

func (a *App) handleMihomoUserConfigSave(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name      string `json:"name"`
		Content   string `json:"content"`
		Overwrite bool   `json:"overwrite"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		req.Name = a.nextMihomoUserConfigName()
	}
	item, validation, err := a.saveMihomoUserConfig(req.Name, req.Content, req.Overwrite, currentUsername(r))
	if err != nil {
		if strings.Contains(err.Error(), "already exists") {
			writeError(w, http.StatusConflict, "config_exists", err.Error())
			return
		}
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	if !validation.Valid {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "error": validation.Error, "data": validation})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"config":         item,
			"validation":     validation,
			"items":          a.mihomoUserConfigItems(),
			"suggested_name": a.nextMihomoUserConfigName(),
		},
	})
}

func (a *App) handleMihomoUserConfigApply(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string `json:"name"`
		Path    string `json:"path"`
		Restart *bool  `json:"restart"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	rel, err := a.mihomoUserConfigRel(req.Name, req.Path)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	restart := true
	if req.Restart != nil {
		restart = *req.Restart
	}
	result, err := a.applyMihomoUserConfig(r.Context(), rel, restart, currentUsername(r))
	if err != nil {
		writeError(w, http.StatusBadRequest, "apply_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (a *App) handleMihomoUserConfigDelete(w http.ResponseWriter, r *http.Request) {
	rel, err := a.mihomoUserConfigRel(r.PathValue("name"), "")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	path, err := a.safePath(rel)
	if err != nil {
		writeError(w, http.StatusBadRequest, "path_error", err.Error())
		return
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		writeError(w, http.StatusBadRequest, "delete_failed", err.Error())
		return
	}
	if a.setting(mihomoAppliedUserConfigKey, "") == rel {
		a.setSetting(mihomoAppliedUserConfigKey, "")
	}
	items := a.mihomoUserConfigItems()
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{"items": items, "files": items}})
}

func (a *App) handleMihomoProxyGroupsConfig(w http.ResponseWriter, r *http.Request) {
	cfg := a.mihomoConfigMap()
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"proxy-groups": cfg["proxy-groups"],
			"groups":       cfg["proxy-groups"],
			"runtime":      a.mihomoProxiesPayload(r),
			"mode":         a.mihomoConfigModePayload(),
		},
	})
}

func (a *App) handleMihomoProxyGroupsConfigPut(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if err := a.updateMihomoConfigSections(req, "proxy-groups"); err != nil {
		writeError(w, http.StatusBadRequest, "write_failed", err.Error())
		return
	}
	_, _ = a.Services.Restart(r.Context(), "mihomo")
	writeJSON(w, http.StatusOK, map[string]any{
		"success":          true,
		"restart_required": false,
		"data":             a.mihomoConfigSectionPayload("proxy-groups", a.mihomoProxiesPayload(r)),
	})
}

func (a *App) saveMihomoUserConfig(name, content string, overwrite bool, username string) (map[string]any, mihomoConfigValidation, error) {
	validation := a.validateMihomoConfigContent(content)
	if !validation.Valid {
		return nil, validation, nil
	}
	rel, err := a.mihomoUserConfigRel(name, "")
	if err != nil {
		return nil, validation, err
	}
	path, err := a.safePath(rel)
	if err != nil {
		return nil, validation, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return nil, validation, err
	}
	if _, err := os.Stat(path); err == nil && !overwrite {
		return nil, validation, fmt.Errorf("user config %s already exists", filepath.Base(path))
	}
	if old, err := a.readTextFile(rel); err == nil {
		a.createConfigHistory("mihomo", rel, old, "backup before user Mihomo config save", username)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return nil, validation, err
	}
	if a.isAppliedMihomoUserConfigRel(rel) {
		if err := a.syncMihomoActiveConfigFromAppliedUserConfig(rel, content, username); err != nil {
			return nil, validation, err
		}
	}
	item := a.mihomoUserConfigItem(rel)
	return item, validation, nil
}

func (a *App) applyMihomoUserConfig(ctx context.Context, rel string, restart bool, username string) (map[string]any, error) {
	rel, err := a.mihomoUserConfigRel("", rel)
	if err != nil {
		return nil, err
	}
	content, err := a.readTextFile(rel)
	if err != nil {
		return nil, err
	}
	validation := a.validateMihomoConfigContent(content)
	if !validation.Valid {
		return nil, fmt.Errorf("%s", validation.Error)
	}
	if cfg, ok := a.latestSetupConfig(); ok {
		cfg.defaults()
		if err := a.validateMihomoContentForProxyMode(cfg, []byte(content)); err != nil {
			return nil, fmt.Errorf("custom config proxy mode conflict: %w", err)
		}
	}
	if err := a.ensureMihomoGeneratedBackup(); err != nil {
		return nil, err
	}
	if old, err := a.readTextFile(mihomoActiveConfigRelPath); err == nil {
		a.createConfigHistory("mihomo", mihomoActiveConfigRelPath, old, "backup before applying user Mihomo config", username)
	}
	if err := a.writeTextFile(mihomoActiveConfigRelPath, content); err != nil {
		return nil, err
	}
	a.setMihomoConfigMode("custom")
	a.setSetting(mihomoAppliedUserConfigKey, rel)
	restarted := false
	if restart {
		_, _ = a.Services.Restart(ctx, "mihomo")
		restarted = true
	}
	return map[string]any{
		"path":       rel,
		"name":       filepath.Base(rel),
		"active":     true,
		"validation": validation,
		"mode":       a.mihomoConfigModePayload(),
		"restarted":  restarted,
		"items":      a.mihomoUserConfigItems(),
	}, nil
}

func (a *App) mihomoUserConfigItems() []map[string]any {
	dir, err := a.safePath(mihomoUserConfigsRelDir)
	if err != nil {
		return nil
	}
	_ = os.MkdirAll(dir, 0755)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	applied := a.setting(mihomoAppliedUserConfigKey, "")
	items := make([]map[string]any, 0)
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == ".keep" {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if ext != ".yaml" && ext != ".yml" {
			continue
		}
		rel := filepath.ToSlash(filepath.Join(mihomoUserConfigsRelDir, entry.Name()))
		item := a.mihomoUserConfigItem(rel)
		item["active"] = rel == applied
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return fmtAny(items[i]["name"]) < fmtAny(items[j]["name"])
	})
	return items
}

func (a *App) mihomoUserConfigItem(rel string) map[string]any {
	name := filepath.Base(rel)
	item := map[string]any{
		"name": name,
		"path": filepath.ToSlash(rel),
		"type": "file",
	}
	if path, err := a.safePath(rel); err == nil {
		if info, err := os.Stat(path); err == nil {
			item["size"] = info.Size()
			item["modified"] = info.ModTime().Format("2006-01-02 15:04:05")
		}
	}
	if rel == a.setting(mihomoAppliedUserConfigKey, "") {
		item["active"] = true
	}
	return item
}

func (a *App) mihomoUserConfigRel(name, relOrPath string) (string, error) {
	value := strings.TrimSpace(relOrPath)
	if value == "" {
		value = strings.TrimSpace(name)
	}
	if strings.HasPrefix(value, mihomoUserConfigsRelDir+"/") {
		value = strings.TrimPrefix(value, mihomoUserConfigsRelDir+"/")
	}
	if strings.HasPrefix(value, "configs/mihomo/") {
		return "", fmt.Errorf("only files under %s are user configs", mihomoUserConfigsRelDir)
	}
	cleanName, err := normalizeMihomoUserConfigName(value)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(filepath.Join(mihomoUserConfigsRelDir, cleanName)), nil
}

func isMihomoActiveConfigRel(rel string) bool {
	return normalizeConfigRel(rel) == mihomoActiveConfigRelPath
}

func isMihomoUserConfigRel(rel string) bool {
	rel = normalizeConfigRel(rel)
	return strings.HasPrefix(rel, mihomoUserConfigsRelDir+"/")
}

func (a *App) appliedMihomoUserConfigRel() (string, bool) {
	applied := strings.TrimSpace(a.setting(mihomoAppliedUserConfigKey, ""))
	if applied == "" {
		return "", false
	}
	rel, err := a.mihomoUserConfigRel("", applied)
	if err != nil {
		return "", false
	}
	return rel, true
}

func (a *App) isAppliedMihomoUserConfigRel(rel string) bool {
	applied, ok := a.appliedMihomoUserConfigRel()
	return ok && normalizeConfigRel(rel) == applied
}

func (a *App) syncMihomoActiveConfigFromAppliedUserConfig(rel, content, username string) error {
	if !a.isAppliedMihomoUserConfigRel(rel) {
		return nil
	}
	if err := a.ensureMihomoGeneratedBackup(); err != nil {
		return err
	}
	if username == "" {
		username = "system"
	}
	if old, err := a.readTextFile(mihomoActiveConfigRelPath); err == nil {
		a.createConfigHistory("mihomo", mihomoActiveConfigRelPath, old, "auto backup before active Mihomo config sync", username)
	}
	if err := a.writeTextFileDirect(mihomoActiveConfigRelPath, content); err != nil {
		return err
	}
	a.setMihomoConfigMode("custom")
	a.setSetting(mihomoAppliedUserConfigKey, normalizeConfigRel(rel))
	return nil
}

func (a *App) reconcileAppliedMihomoUserConfig() error {
	rel, ok := a.appliedMihomoUserConfigRel()
	if !ok {
		return nil
	}
	content, err := a.readTextFile(rel)
	if err != nil {
		a.setSetting(mihomoAppliedUserConfigKey, "")
		return nil
	}
	if validation := a.validateMihomoConfigContent(content); !validation.Valid {
		a.setSetting(mihomoAppliedUserConfigKey, "")
		return nil
	}
	return a.syncMihomoActiveConfigFromAppliedUserConfig(rel, content, "system")
}

func (a *App) nextMihomoUserConfigName() string {
	dir, err := a.safePath(mihomoUserConfigsRelDir)
	if err != nil {
		return "user_config_0.yaml"
	}
	_ = os.MkdirAll(dir, 0755)
	for i := 0; i <= 9; i++ {
		name := fmt.Sprintf("user_config_%d.yaml", i)
		if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
			return name
		}
	}
	return "user_config_" + nowStringCompact() + ".yaml"
}

func normalizeMihomoUserConfigName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("config name is required")
	}
	if strings.ContainsAny(name, `/\`) || strings.Contains(name, "..") {
		return "", fmt.Errorf("config name cannot contain path separators or ..")
	}
	if strings.HasPrefix(name, ".") {
		return "", fmt.Errorf("config name cannot be hidden")
	}
	if len([]rune(name)) > 120 {
		return "", fmt.Errorf("config name is too long")
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext == "" {
		name += ".yaml"
		ext = ".yaml"
	}
	if ext != ".yaml" && ext != ".yml" {
		return "", fmt.Errorf("config name must end with .yaml or .yml")
	}
	switch strings.ToLower(name) {
	case "config.yaml", "phone_config.yaml", "msf_generated.backup.yaml", "config.yaml.backup":
		return "", fmt.Errorf("%s is a reserved config name", name)
	}
	return name, nil
}

func nowStringCompact() string {
	return strings.NewReplacer("-", "", ":", "", " ", "", "T", "", "Z", "", "+", "").Replace(nowString())
}

func (a *App) mihomoConfigModePayload() map[string]any {
	backupRel := a.mihomoGeneratedBackupPath()
	backupPath, err := a.safePath(backupRel)
	backupExists := err == nil && fileExists(backupPath)
	activePath, hasActive := a.appliedMihomoUserConfigRel()
	activeName := ""
	if hasActive {
		activeName = filepath.Base(activePath)
	}
	return map[string]any{
		"mode":              a.mihomoConfigMode(),
		"backup_path":       backupRel,
		"backup_exists":     backupExists,
		"active_path":       activePath,
		"active_name":       activeName,
		"is_default":        !hasActive && a.mihomoConfigMode() == "generated",
		"protected_fields":  a.mihomoProtectedFields(),
		"protected_warning": "自定义配置请保留这些字段，否则 WebUI、MosDNS 转发或透明代理可能无法正常工作。",
	}
}

func (a *App) mihomoConfigMode() string {
	mode := strings.ToLower(strings.TrimSpace(a.setting(mihomoConfigModeKey, "generated")))
	if mode == "custom" {
		return "custom"
	}
	return "generated"
}

func (a *App) setMihomoConfigMode(mode string) {
	if mode != "custom" {
		mode = "generated"
	}
	a.setSetting(mihomoConfigModeKey, mode)
	a.setSetting(mihomoGeneratedBackupPathKey, a.mihomoGeneratedBackupPath())
}

func (a *App) mihomoGeneratedBackupPath() string {
	value := strings.TrimSpace(a.setting(mihomoGeneratedBackupPathKey, mihomoGeneratedBackupRelPath))
	if value == "" {
		return mihomoGeneratedBackupRelPath
	}
	if !strings.HasPrefix(value, "configs/mihomo/") {
		return mihomoGeneratedBackupRelPath
	}
	return filepath.ToSlash(value)
}

func (a *App) ensureMihomoGeneratedBackup() error {
	if a.mihomoConfigMode() == "custom" {
		return nil
	}
	backupRel := a.mihomoGeneratedBackupPath()
	backupPath, err := a.safePath(backupRel)
	if err != nil {
		return err
	}
	if fileExists(backupPath) {
		return nil
	}
	content, err := a.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(backupPath), 0755); err != nil {
		return err
	}
	return os.WriteFile(backupPath, []byte(content), 0644)
}

func mihomoConfigSectionsDefaultSafe(sections []string) bool {
	if len(sections) == 0 {
		return false
	}
	for _, section := range sections {
		if section != "proxy-providers" {
			return false
		}
	}
	return true
}

func mihomoConfigOnlyProxyProvidersChanged(oldContent, newContent string) (bool, error) {
	oldMap, err := mihomoConfigTopMap(oldContent)
	if err != nil {
		return false, err
	}
	newMap, err := mihomoConfigTopMap(newContent)
	if err != nil {
		return false, err
	}
	delete(oldMap, "proxy-providers")
	delete(newMap, "proxy-providers")
	return reflect.DeepEqual(oldMap, newMap), nil
}

func mihomoConfigTopMap(content string) (map[string]any, error) {
	var cfg map[string]any
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		return nil, err
	}
	if cfg == nil {
		return map[string]any{}, nil
	}
	return cfg, nil
}

func (a *App) validateMihomoActiveConfigWrite(content string) (mihomoConfigValidation, bool, string, error) {
	validation := a.validateMihomoConfigContent(content)
	if !validation.Valid {
		return validation, false, "", nil
	}
	if a.mihomoConfigMode() != "generated" {
		return validation, true, "", nil
	}
	oldContent, err := a.readTextFile(mihomoActiveConfigRelPath)
	if err != nil {
		return validation, false, "read_failed", err
	}
	allowed, err := mihomoConfigOnlyProxyProvidersChanged(oldContent, content)
	if err != nil {
		return validation, false, "bad_request", err
	}
	if !allowed {
		return validation, false, "default_config_requires_user_config", fmt.Errorf("default Mihomo config only allows proxy-providers changes; save as a user config for other fields")
	}
	return validation, false, "", nil
}

func (a *App) defaultMihomoConfigForRestore() (string, string, error) {
	backupRel := a.mihomoGeneratedBackupPath()
	cfg, ok := a.latestSetupConfig()
	if !ok {
		cfg = SetupConfig{
			Timezone:          "Asia/Shanghai",
			WebPort:           "7777",
			SelectedInterface: "eth0",
			MihomoCoreType:    "meta",
			AutoSetDNS:        true,
			EnableIPv6:        true,
			ProxyCore:         "mihomo",
			MosDNSEnabled:     true,
		}
	}
	cfg.defaults()
	if content, err := a.readTextFile(backupRel); err == nil && strings.TrimSpace(content) != "" {
		if err := a.validateMihomoContentForProxyMode(cfg, []byte(content)); err == nil {
			return content, backupRel, nil
		}
	}
	return a.renderMihomoYAML(cfg), "generated-template", nil
}

func (a *App) mihomoCustomTemplateContent() string {
	cfg, ok := a.latestSetupConfig()
	if !ok {
		cfg = SetupConfig{SelectedInterface: "eth0", ProxyCore: "mihomo", MosDNSEnabled: true, EnableIPv6: true}
	}
	cfg.defaults()
	body := a.renderMihomoYAML(cfg)
	protected := strings.Join(a.mihomoProtectedFields(), "\n#    ")
	return strings.TrimRight(`# MSF 自定义 Mihomo config.yaml 模板
# 使用说明：
# 1. 下面这些字段和 MSF WebUI / MosDNS / 透明代理直接挂钩，除非您明确知道影响，否则不要删除或改端口：
`, "\n") + "#    " + protected + strings.TrimRight(`
# 2. 您可以自由修改 proxy-groups、proxy-providers、rule-providers、rules。
# 3. 如果设置 secret，MSF 会从配置中读取它并用于连接 Mihomo 控制器。
# 4. 保存后 MSF 会备份旧配置并重启 Mihomo。

`, "\n") + "\n" + body
}

func (a *App) validateMihomoConfigContent(content string) mihomoConfigValidation {
	return validateMihomoConfigContent(content, a.currentLinuxProxyMode())
}

func validateMihomoConfigContent(content string, proxyModes ...string) mihomoConfigValidation {
	var cfg map[string]any
	if err := yaml.Unmarshal([]byte(content), &cfg); err != nil {
		return mihomoConfigValidation{Valid: false, Error: err.Error()}
	}
	if cfg == nil {
		return mihomoConfigValidation{Valid: false, Error: "config must be a YAML object"}
	}
	warnings := make([]string, 0)
	check := func(key string, want any) {
		if _, ok := cfg[key]; !ok {
			warnings = append(warnings, fmt.Sprintf("缺少关键字段 %s", key))
			return
		}
		if want != nil && fmtAny(cfg[key]) != fmtAny(want) {
			warnings = append(warnings, fmt.Sprintf("关键字段 %s 当前为 %q，建议保持 %q", key, fmtAny(cfg[key]), fmtAny(want)))
		}
	}
	check("external-controller", ":9090")
	check("external-ui", "ui")
	check("port", 7890)
	check("socks-port", 7891)
	if isTUNProxyMode(setupPreflightProxyMode(proxyModes...)) {
		if tun, ok := cfg["tun"].(map[string]any); ok {
			if !isTruthy(fmtAny(tun["enable"])) {
				warnings = append(warnings, "tun.enable 建议保持 true")
			}
			if fmtAny(tun["stack"]) != "system" {
				warnings = append(warnings, "tun.stack 建议保持 system，减少 Docker/Linux TUN 环境差异")
			}
			for _, key := range []string{"auto-route", "auto-detect-interface"} {
				if !isTruthy(fmtAny(tun[key])) {
					warnings = append(warnings, fmt.Sprintf("tun.%s 建议保持 true", key))
				}
			}
			if isTruthy(fmtAny(tun["auto-redirect"])) {
				warnings = append(warnings, "TUN 模式建议保持 tun.auto-redirect=false，避免写宿主机 iptables/nftables")
			}
			if value, ok := tun["dns-hijack"]; !ok || !yamlListEmpty(value) {
				warnings = append(warnings, "TUN 模式建议保持 tun.dns-hijack=[]，由 MosDNS 继续负责 DNS 分流")
			}
			if value, ok := tun["route-address"]; !ok || !yamlListContains(value, "28.0.0.0/8") {
				warnings = append(warnings, "TUN 模式建议在 tun.route-address 中包含 Fake-IP IPv4 网段 28.0.0.0/8")
			}
			if value, ok := tun["route-exclude-address"]; !ok || !yamlListContains(value, "192.168.0.0/16") {
				warnings = append(warnings, "TUN 模式建议在 tun.route-exclude-address 中排除局域网网段")
			}
		} else {
			warnings = append(warnings, "TUN 模式缺少 tun 配置块")
		}
		for _, key := range []string{"redir-port", "tproxy-port", "routing-mark"} {
			if _, ok := cfg[key]; ok {
				warnings = append(warnings, fmt.Sprintf("TUN 模式不需要 %s，建议删除", key))
			}
		}
	} else {
		check("redir-port", 7877)
		check("tproxy-port", 7896)
	}
	if dns, ok := cfg["dns"].(map[string]any); ok {
		if fmtAny(dns["listen"]) != "0.0.0.0:6666" {
			warnings = append(warnings, "dns.listen 建议保持 0.0.0.0:6666，否则 MosDNS 可能无法转发到 Mihomo")
		}
		if isTUNProxyMode(setupPreflightProxyMode(proxyModes...)) {
			if value, ok := dns["proxy-server-nameserver"]; !ok || yamlListEmpty(value) {
				warnings = append(warnings, "TUN 模式建议配置 dns.proxy-server-nameserver，避免节点域名被 Fake-IP 污染")
			}
		}
	} else {
		warnings = append(warnings, "缺少 dns.listen")
	}
	if profile, ok := cfg["profile"].(map[string]any); ok {
		if value, ok := profile["store-selected"]; !ok || !isTruthy(fmtAny(value)) {
			warnings = append(warnings, "profile.store-selected 建议保持 true，保证节点选择状态稳定")
		}
	} else {
		warnings = append(warnings, "缺少 profile.store-selected")
	}
	return mihomoConfigValidation{Valid: true, Warnings: warnings}
}

func (a *App) mihomoProtectedFields() []string {
	fields := []string{
		"external-controller: :9090",
		"external-ui: ui",
		"port: 7890",
		"socks-port: 7891",
		"dns.listen: 0.0.0.0:6666",
		"profile.store-selected: true",
	}
	if isTUNProxyMode(a.currentLinuxProxyMode()) {
		fields = append(fields,
			"tun.enable: true",
			"tun.stack: system",
			"tun.auto-route: true",
			"tun.auto-detect-interface: true",
			"tun.auto-redirect: false",
			"tun.dns-hijack: []",
			"tun.route-address 包含 Fake-IP 网段",
			"dns.proxy-server-nameserver",
		)
	} else {
		fields = append(fields,
			"redir-port: 7877",
			"tproxy-port: 7896",
		)
	}
	return append(fields, "secret 如用户设置，MSF 会读取并用于控制器认证")
}

func yamlListEmpty(value any) bool {
	switch v := value.(type) {
	case nil:
		return true
	case []any:
		return len(v) == 0
	case []string:
		return len(v) == 0
	default:
		return strings.TrimSpace(fmtAny(v)) == "" || strings.TrimSpace(fmtAny(v)) == "[]"
	}
}

func yamlListContains(value any, want string) bool {
	switch v := value.(type) {
	case []any:
		for _, item := range v {
			if strings.TrimSpace(fmtAny(item)) == want {
				return true
			}
		}
	case []string:
		for _, item := range v {
			if strings.TrimSpace(item) == want {
				return true
			}
		}
	default:
		for _, item := range strings.Split(fmtAny(v), " ") {
			if strings.Trim(strings.TrimSpace(item), "[],") == want {
				return true
			}
		}
	}
	return false
}

func (a *App) mihomoConfigSectionPayload(section string, runtime any) map[string]any {
	cfg := a.mihomoConfigMap()
	return map[string]any{
		section:                               cfg[section],
		strings.ReplaceAll(section, "-", "_"): cfg[section],
		"runtime":                             runtime,
		"mode":                                a.mihomoConfigModePayload(),
	}
}
