package server

import (
	"net/http"
	"strings"
	"testing"
)

func TestDockerRuntimeEnvOverride(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "docker")
	if !IsDockerRuntime() {
		t.Fatal("MSF_RUNTIME=docker should enable Docker runtime")
	}

	t.Setenv("MSF_RUNTIME", "native")
	if IsDockerRuntime() {
		t.Fatal("non-empty non-docker MSF_RUNTIME should disable Docker auto-detection")
	}
}

func TestDockerCleanupNetworkOnExitDefault(t *testing.T) {
	t.Setenv("MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT", "")
	if !DockerCleanupNetworkOnExit() {
		t.Fatal("Docker network cleanup should default to enabled")
	}

	t.Setenv("MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT", "false")
	if DockerCleanupNetworkOnExit() {
		t.Fatal("MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT=false should disable cleanup")
	}
}

func TestDockerRuntimeDisablesSelfUpdateAPI(t *testing.T) {
	t.Setenv("MSF_RUNTIME", "docker")
	app := newTestApp(t)
	token := tokenForRole(t, app, "admin")

	status := requestJSON(t, app, http.MethodGet, "/api/v1/update/status", token, nil)
	for _, want := range []string{`"supported":false`, `"has_update":false`, DockerUpdateDisabledReason()} {
		if !strings.Contains(status.Body.String(), want) {
			t.Fatalf("docker update status missing %q: status=%d body=%s", want, status.Code, status.Body.String())
		}
	}

	for _, item := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/update/check"},
		{http.MethodPost, "/api/v1/update/download"},
		{http.MethodPost, "/api/v1/update/install"},
	} {
		res := requestJSON(t, app, item.method, item.path, token, nil)
		if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"success":false`) || !strings.Contains(res.Body.String(), DockerUpdateDisabledReason()) {
			t.Fatalf("%s %s should reject self-update in docker: status=%d body=%s", item.method, item.path, res.Code, res.Body.String())
		}
	}
}

func TestPolicyRouteCommandsAreIdempotent(t *testing.T) {
	deletes := policyRouteRuleDeleteCommands()
	if len(deletes) != 32 {
		t.Fatalf("policyRouteRuleDeleteCommands len=%d, want 32", len(deletes))
	}
	install := strings.Join(flattenCommandArgs(policyRouteInstallCommands()), "\n")
	for _, want := range []string{
		"ip rule add fwmark 1 table 100",
		"ip route replace local 0.0.0.0/0 dev lo table 100",
		"ip -6 rule add fwmark 1 table 100",
		"ip -6 route replace local ::/0 dev lo table 100",
	} {
		if !strings.Contains(install, want) {
			t.Fatalf("install commands missing %q:\n%s", want, install)
		}
	}
	clear := strings.Join(flattenCommandArgs(policyRouteClearCommands()), "\n")
	for _, want := range []string{
		"ip rule del fwmark 1 table 100",
		"ip route del local 0.0.0.0/0 dev lo table 100",
		"ip -6 rule del fwmark 1 table 100",
		"ip -6 route del local ::/0 dev lo table 100",
	} {
		if !strings.Contains(clear, want) {
			t.Fatalf("clear commands missing %q:\n%s", want, clear)
		}
	}
}

func flattenCommandArgs(cmds [][]string) []string {
	out := make([]string, 0, len(cmds))
	for _, cmd := range cmds {
		out = append(out, strings.Join(cmd, " "))
	}
	return out
}
