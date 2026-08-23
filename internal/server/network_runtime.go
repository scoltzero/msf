package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"runtime"
	"strings"
	"time"
)

const (
	networkRuntimeDesiredKey = "network.runtime.desired"
	networkRuntimeUpdatedKey = "network.runtime.updated_at"
	runtimeStateEnabled      = "enabled"
	runtimeStateDirect       = "direct"
	runtimeStateStopped      = "stopped"
)

func (a *App) registerNetworkRuntimeRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/network/runtime", a.handleNetworkRuntime)
	mux.HandleFunc("POST /api/v1/network/runtime/enable", a.handleNetworkRuntimeEnable)
	mux.HandleFunc("POST /api/v1/network/runtime/disable", a.handleNetworkRuntimeDisable)
	mux.HandleFunc("POST /api/v1/network/runtime/restart", a.handleNetworkRuntimeRestart)
	mux.HandleFunc("POST /api/v1/network/runtime/stop", a.handleNetworkRuntimeStop)
}

func (a *App) handleNetworkRuntime(w http.ResponseWriter, r *http.Request) {
	data := a.networkRuntimeSnapshot(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (a *App) handleNetworkRuntimeEnable(w http.ResponseWriter, r *http.Request) {
	a.handleNetworkRuntimeAction(w, r, "enable")
}

func (a *App) handleNetworkRuntimeDisable(w http.ResponseWriter, r *http.Request) {
	a.handleNetworkRuntimeAction(w, r, "disable")
}

func (a *App) handleNetworkRuntimeRestart(w http.ResponseWriter, r *http.Request) {
	a.handleNetworkRuntimeAction(w, r, "restart")
}

func (a *App) handleNetworkRuntimeStop(w http.ResponseWriter, r *http.Request) {
	a.handleNetworkRuntimeAction(w, r, "stop")
}

func (a *App) handleNetworkRuntimeAction(w http.ResponseWriter, r *http.Request, action string) {
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	if err := a.performNetworkRuntimeAction(ctx, action); err != nil {
		a.setNetworkRuntimeLastError(err.Error())
		writeJSON(w, http.StatusConflict, map[string]any{
			"success": false,
			"error":   "network_runtime_" + action + "_failed",
			"message": err.Error(),
			"data":    a.networkRuntimeSnapshot(r.Context()),
		})
		return
	}
	a.setNetworkRuntimeLastError("")
	if user := currentUser(r); user != nil {
		a.audit(user, "network.runtime."+action, "network", "runtime", true, "")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"action":  action,
		"data":    a.networkRuntimeSnapshot(r.Context()),
	})
}

func (a *App) performNetworkRuntimeAction(ctx context.Context, action string) error {
	a.networkRuntimeMu.Lock()
	defer a.networkRuntimeMu.Unlock()

	if !a.IsInitialized() {
		return errors.New("MSF 尚未完成初始化，请先打开网页管理页完成设置")
	}
	cfg, ok := a.latestSetupConfig()
	if !ok {
		return errors.New("找不到已保存的 MSF 设置")
	}
	cfg.defaults()
	if err := validateSetupProxyMode(cfg); err != nil {
		return err
	}
	if IsMacOSRuntime() && !isTUNProxyMode(cfg.LinuxProxyMode) {
		return errors.New("macOS 仅支持 TUN 模式")
	}

	switch action {
	case "enable":
		a.setNetworkTransition("starting")
		defer a.setNetworkTransition("")
		return a.enableNetworkRuntimeLocked(ctx, cfg, runtimeStateEnabled)
	case "disable":
		a.setNetworkTransition("")
		return a.disableNetworkRuntimeLocked(ctx)
	case "restart":
		a.setNetworkTransition("restarting")
		defer a.setNetworkTransition("")
		return a.restartNetworkRuntimeLocked(ctx, cfg)
	case "stop":
		a.setNetworkTransition("")
		return a.stopNetworkRuntimeLocked(ctx, cfg, true)
	default:
		return fmt.Errorf("unknown network runtime action %q", action)
	}
}

func (a *App) enableNetworkRuntimeLocked(ctx context.Context, cfg SetupConfig, desired string) error {
	started := make([]string, 0, 2)
	for _, name := range managedServiceNames() {
		shouldRun := name == "mihomo" || (name == "mosdns" && cfg.MosDNSEnabled)
		if !shouldRun {
			continue
		}
		wasRunning := a.Services.Status(name).Running
		if _, err := a.Services.Start(ctx, name); err != nil {
			a.stopNewlyStartedServices(ctx, started)
			return fmt.Errorf("启动 %s: %w", name, err)
		}
		if !wasRunning {
			started = append(started, name)
		}
	}
	if err := applyPlatformNetwork(ctx, a, cfg); err != nil {
		_ = restorePlatformNetwork(ctx, a, cfg)
		a.stopNewlyStartedServices(ctx, started)
		return err
	}
	mode := "rule"
	if desired == runtimeStateDirect {
		mode = "direct"
	}
	if err := a.setMihomoRuntimeMode(mode); err != nil {
		_ = restorePlatformNetwork(ctx, a, cfg)
		a.stopNewlyStartedServices(ctx, started)
		return err
	}
	a.Services.setDesired("mihomo", true)
	a.Services.setDesired("mosdns", cfg.MosDNSEnabled)
	a.persistNetworkRuntimeDesired(desired)
	return nil
}

func (a *App) disableNetworkRuntimeLocked(ctx context.Context) error {
	if !a.Services.Status("mihomo").Running || !a.Services.Status("mosdns").Running {
		return errors.New("数据面尚未完整运行，无法切换到 LAN 直连保活")
	}
	if err := a.setMihomoRuntimeMode("direct"); err != nil {
		return err
	}
	a.persistNetworkRuntimeDesired(runtimeStateDirect)
	return nil
}

func (a *App) restartNetworkRuntimeLocked(ctx context.Context, cfg SetupConfig) error {
	desired := a.networkRuntimeDesired()
	if desired == runtimeStateStopped {
		desired = runtimeStateEnabled
	}
	var errs []error
	for i := len(managedServiceNames()) - 1; i >= 0; i-- {
		name := managedServiceNames()[i]
		if _, err := a.Services.stop(ctx, name, false); err != nil {
			errs = append(errs, fmt.Errorf("停止 %s: %w", name, err))
		}
	}
	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return a.enableNetworkRuntimeLocked(ctx, cfg, desired)
}

func (a *App) stopNetworkRuntimeLocked(ctx context.Context, cfg SetupConfig, persist bool) error {
	var errs []error
	if err := restorePlatformNetwork(ctx, a, cfg); err != nil {
		errs = append(errs, err)
	}
	for i := len(managedServiceNames()) - 1; i >= 0; i-- {
		name := managedServiceNames()[i]
		if _, err := a.Services.stop(ctx, name, false); err != nil {
			errs = append(errs, fmt.Errorf("停止 %s: %w", name, err))
		}
	}
	if persist {
		a.Services.setDesired("mihomo", false)
		a.Services.setDesired("mosdns", false)
		a.persistNetworkRuntimeDesired(runtimeStateStopped)
	}
	return errors.Join(errs...)
}

func (a *App) stopNewlyStartedServices(ctx context.Context, names []string) {
	for i := len(names) - 1; i >= 0; i-- {
		_, _ = a.Services.stop(ctx, names[i], false)
	}
}

func (a *App) setMihomoRuntimeMode(mode string) error {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "rule" && mode != "direct" {
		return fmt.Errorf("unsupported Mihomo runtime mode %q", mode)
	}
	body := []byte(fmt.Sprintf(`{"mode":%q}`, mode))
	if _, ok, err := a.mihomoControllerJSON(http.MethodPatch, "/configs", body); !ok {
		if err == nil {
			err = errors.New("Mihomo controller unavailable")
		}
		return fmt.Errorf("切换 Mihomo 到 %s 模式: %w", mode, err)
	}
	return nil
}

func (a *App) networkRuntimeSnapshot(ctx context.Context) map[string]any {
	mosdns := a.Services.Status("mosdns")
	mihomo := a.Services.Status("mihomo")
	desired := a.networkRuntimeDesired()
	transition, lastError := a.networkRuntimeState()
	effective := runtimeStateStopped
	switch {
	case transition != "":
		effective = transition
	case mosdns.Running && mihomo.Running && desired == runtimeStateDirect:
		effective = runtimeStateDirect
	case mosdns.Running && mihomo.Running:
		effective = runtimeStateEnabled
	case mosdns.Running || mihomo.Running:
		effective = "degraded"
	}
	trafficRaw := a.mihomoTrafficCachedPayload()
	traffic := map[string]any{
		"down_bps": numericMapValue(trafficRaw, "down"),
		"up_bps":   numericMapValue(trafficRaw, "up"),
		"down":     numericMapValue(trafficRaw, "down"),
		"up":       numericMapValue(trafficRaw, "up"),
	}
	message := ""
	if !a.IsInitialized() {
		message = "请先打开网页管理页完成初始化"
	} else if lastError != "" {
		message = lastError
	} else if effective == runtimeStateDirect {
		message = "TUN 与 DNS 保持运行，全部流量直连"
	} else if effective == runtimeStateStopped {
		message = "MosDNS、Mihomo 与系统网络接管均已停止"
	}
	return map[string]any{
		"effective_state":       effective,
		"state":                 effective,
		"desired_state":         desired,
		"supports_safe_disable": true,
		"platform":              runtime.GOOS + "/" + runtime.GOARCH,
		"initialized":           a.IsInitialized(),
		"mosdns_running":        mosdns.Running,
		"mihomo_running":        mihomo.Running,
		"services": map[string]any{
			"mosdns": mosdns,
			"mihomo": mihomo,
		},
		"traffic":    traffic,
		"network":    platformNetworkStatus(ctx, a),
		"message":    message,
		"last_error": lastError,
		"updated_at": a.setting(networkRuntimeUpdatedKey, ""),
	}
}

func (a *App) networkRuntimeDesired() string {
	value := strings.ToLower(strings.TrimSpace(a.setting(networkRuntimeDesiredKey, "")))
	switch value {
	case runtimeStateEnabled, runtimeStateDirect, runtimeStateStopped:
		return value
	default:
		if a.IsInitialized() {
			return runtimeStateEnabled
		}
		return runtimeStateStopped
	}
}

func (a *App) persistNetworkRuntimeDesired(value string) {
	a.setSetting(networkRuntimeDesiredKey, value)
	a.setSetting(networkRuntimeUpdatedKey, nowString())
}

func (a *App) setNetworkTransition(value string) {
	a.networkStateMu.Lock()
	a.networkTransition = value
	a.networkStateMu.Unlock()
}

func (a *App) setNetworkRuntimeLastError(value string) {
	a.networkStateMu.Lock()
	a.networkLastError = value
	a.networkStateMu.Unlock()
}

func (a *App) networkRuntimeState() (string, string) {
	a.networkStateMu.RLock()
	defer a.networkStateMu.RUnlock()
	return a.networkTransition, a.networkLastError
}
