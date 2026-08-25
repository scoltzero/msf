package policy

import (
	"testing"

	"github.com/scoltzero/msf/internal/assistant"
	"github.com/scoltzero/msf/internal/assistant/catalog"
)

func mustCapability(t *testing.T, name string) catalog.Capability {
	t.Helper()
	c, err := catalog.Default()
	if err != nil {
		t.Fatal(err)
	}
	for _, capability := range c.Capabilities {
		if capability.Name == name {
			return capability
		}
	}
	t.Fatalf("capability %q not found", name)
	return catalog.Capability{}
}

func TestDecideReadAndWriteModes(t *testing.T) {
	read := mustCapability(t, "mosdns_status")
	if decision := Decide(read, assistant.ExecutionReadOnly, false); !decision.Allowed {
		t.Fatalf("safe read should be allowed: %+v", decision)
	}
	write := mustCapability(t, "service_restart")
	if decision := Decide(write, assistant.ExecutionConfirmWrites, false); !decision.ConfirmationNeeded || decision.Allowed {
		t.Fatalf("write should require confirmation: %+v", decision)
	}
	if decision := Decide(write, assistant.ExecutionConfirmWrites, true); !decision.Allowed {
		t.Fatalf("approved write should be allowed: %+v", decision)
	}
	if decision := Decide(write, assistant.ExecutionFullAuto, false); !decision.Allowed || decision.ConfirmationNeeded || decision.Reason != "full_auto" {
		t.Fatalf("full-auto mode should execute writes: %+v", decision)
	}
}

func TestReadOnlyModeBlocksWrites(t *testing.T) {
	write := mustCapability(t, "service_restart")
	decision := Decide(write, assistant.ExecutionReadOnly, true)
	if decision.Allowed || decision.ConfirmationNeeded || decision.Reason != "read_only_mode" {
		t.Fatalf("read-only mode must block writes: %+v", decision)
	}
}
