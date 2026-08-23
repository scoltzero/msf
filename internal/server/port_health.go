package server

import (
	"context"
	"strings"
	"time"
)

const (
	mihomoRedirectPort = 7877
	mihomoTProxyPort   = 7896
)

// transparentPortListenerCollector inspects the kernel listener table without
// connecting to Mihomo's transparent proxy ports. A TCP connect to either port
// is interpreted as proxied traffic by Mihomo and produces a loopback warning.
var transparentPortListenerCollector = func(ctx context.Context) []setupPortListener {
	ports := []int{mihomoRedirectPort, mihomoTProxyPort}
	if out, err := setupCommandOutput(ctx, time.Second, "ss", "-H", "-lntup"); err == nil {
		return dedupeSetupListeners(parseSSListeners(string(out), "tcp", ports))
	}
	return collectSetupPortListeners(ctx, ports)
}

func mihomoTransparentPortHealth(service ServiceStatus, ports map[string]int) map[string]bool {
	health := map[string]bool{"redir": false, "tproxy": false}
	if !service.Running {
		return health
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	listeners := transparentPortListenerCollector(ctx)
	health["redir"] = listenerOwnedByService(listeners, ports["redir"], "tcp", service)
	// TProxy may expose TCP and UDP on the same port. Either listener confirms
	// that the configured transparent entry point has been bound.
	health["tproxy"] = listenerOwnedByService(listeners, ports["tproxy"], "", service)
	return health
}

func listenerOwnedByService(listeners []setupPortListener, port int, protocol string, service ServiceStatus) bool {
	if !service.Running || port <= 0 {
		return false
	}
	for _, listener := range listeners {
		if listener.Port != port || (protocol != "" && listener.Protocol != protocol) {
			continue
		}
		if listener.PID > 0 && service.PID > 0 {
			if listener.PID == service.PID {
				return true
			}
			continue
		}
		if listener.Process != "" && service.Name != "" && !strings.Contains(strings.ToLower(listener.Process), strings.ToLower(service.Name)) {
			continue
		}
		// ss may omit process metadata without sufficient permissions. The
		// combination of a live managed service and a bound configured port is
		// still stronger than probing the transparent listener itself.
		return true
	}
	return false
}
