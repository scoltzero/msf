package server

import (
	"context"
	"os"
	"strings"
)

const dockerUpdateDisabledReason = "Docker containers should be updated by pulling a new image"

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

func DockerUpdateDisabledReason() string {
	return dockerUpdateDisabledReason
}

func (a *App) ShutdownRuntime(ctx context.Context) error {
	err := a.Services.StopAll(ctx)
	if IsDockerRuntime() && DockerCleanupNetworkOnExit() {
		if _, clearErr := a.clearNFT(ctx); clearErr != nil && err == nil {
			err = clearErr
		}
	}
	return err
}
