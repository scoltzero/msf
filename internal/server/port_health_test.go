package server

import (
	"context"
	"testing"
)

func TestListenerOwnedByServiceRequiresMatchingManagedProcess(t *testing.T) {
	service := ServiceStatus{Name: "mihomo", Running: true, PID: 42}
	listeners := []setupPortListener{
		{Port: mihomoRedirectPort, Protocol: "tcp", PID: 42, Process: "mihomo"},
		{Port: mihomoTProxyPort, Protocol: "tcp", PID: 99, Process: "other"},
	}
	if !listenerOwnedByService(listeners, mihomoRedirectPort, "tcp", service) {
		t.Fatal("expected redirect listener owned by Mihomo to be healthy")
	}
	if listenerOwnedByService(listeners, mihomoTProxyPort, "", service) {
		t.Fatal("listener owned by another process must not be reported healthy")
	}
	service.Running = false
	if listenerOwnedByService(listeners, mihomoRedirectPort, "tcp", service) {
		t.Fatal("stopped service must not report a healthy listener")
	}
}

func TestMihomoTransparentPortHealthUsesListenerSnapshot(t *testing.T) {
	old := transparentPortListenerCollector
	transparentPortListenerCollector = func(_ context.Context) []setupPortListener {
		return []setupPortListener{
			{Port: mihomoRedirectPort, Protocol: "tcp", PID: 42, Process: "mihomo"},
			{Port: mihomoTProxyPort, Protocol: "udp", PID: 42, Process: "mihomo"},
		}
	}
	t.Cleanup(func() { transparentPortListenerCollector = old })

	health := mihomoTransparentPortHealth(
		ServiceStatus{Name: "mihomo", Running: true, PID: 42},
		map[string]int{"redir": mihomoRedirectPort, "tproxy": mihomoTProxyPort},
	)
	if !health["redir"] || !health["tproxy"] {
		t.Fatalf("transparent listener health = %#v, want both healthy", health)
	}
}
