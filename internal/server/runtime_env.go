package server

import (
	"context"
	"os"
	"strings"
)

const dockerUpdateDisabledReason = "Docker containers should be updated by pulling a new image"
const fnOSUpdateDisabledReason = "fnOS FPK installs should be updated from fnOS / 飞牛应用中心 or the FPK package manager"

func IsDockerRuntime() bool {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("MSF_RUNTIME")))
	if mode == "docker" || mode == "container" {
		return true
	}
	if mode != "" {
		return false
	}
	if fileExists("/.dockerenv") {
		return true
	}
	for _, path := range []string{"/proc/1/cgroup", "/proc/self/cgroup"} {
		b, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		text := strings.ToLower(string(b))
		if strings.Contains(text, "docker") || strings.Contains(text, "containerd") || strings.Contains(text, "kubepods") || strings.Contains(text, "podman") {
			return true
		}
	}
	return false
}

func DockerCleanupNetworkOnExit() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT")))
	return value == "" || value == "1" || value == "true" || value == "yes" || value == "on"
}

func DockerNetworkMode() string {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("MSF_DOCKER_NETWORK_MODE")))
	switch value {
	case "macvlan", "macvlan-tun":
		return "macvlan-tun"
	case "host", "host-tun", "":
		return "host-tun"
	default:
		return value
	}
}

func DockerUpdateDisabledReason() string {
	return dockerUpdateDisabledReason
}

func IsFnOSFPKRuntime() bool {
	for _, key := range []string{"MSF_RUNTIME", "MSF_PACKAGE_RUNTIME", "MSF_PACKAGE_TYPE", "FNOS_RUNTIME", "FNOS_PACKAGE_TYPE"} {
		value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
		if value == "fnos" || value == "fpk" || value == "fnos-fpk" || strings.Contains(value, "fnos") || strings.Contains(value, "fpk") {
			return true
		}
	}
	for _, path := range []string{"/etc/fnos-release", "/etc/feiniu-release", "/etc/fnOS-release", "/usr/local/fnos", "/var/packages/msf"} {
		if fileExists(path) {
			return true
		}
	}
	return false
}

func FnOSUpdateDisabledReason() string {
	return fnOSUpdateDisabledReason
}

func (a *App) ShutdownRuntime(ctx context.Context) error {
	err := a.Services.StopAll(ctx)
	if IsDockerRuntime() && DockerCleanupNetworkOnExit() && a.shouldCleanupDockerNetwork() {
		if _, clearErr := a.clearNFT(ctx); clearErr != nil && err == nil {
			err = clearErr
		}
	}
	return err
}

func (a *App) shouldCleanupDockerNetwork() bool {
	if desired := a.setting(nftDesiredKey, ""); desired != "" {
		return desired == "true"
	}
	if cfg, ok := a.latestSetupConfig(); ok {
		cfg.defaults()
		return shouldRestoreNFT(cfg)
	}
	return false
}
