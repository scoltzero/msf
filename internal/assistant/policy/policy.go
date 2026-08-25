package policy

import (
	"fmt"

	"github.com/scoltzero/msf/internal/assistant"
	"github.com/scoltzero/msf/internal/assistant/catalog"
)

// Decide applies the administrator's execution mode to one catalog entry.
// Permissions and confirmation are deliberately separate: an administrator
// may execute every cataloged capability, but high-impact actions still need a
// deliberate UI confirmation to protect against model misunderstandings.
func Decide(capability catalog.Capability, mode assistant.ExecutionMode, approved bool) assistant.Decision {
	if capability.Exposure == assistant.ExposureInternal {
		return assistant.Decision{Reason: "internal_capability"}
	}
	if capability.Risk == assistant.RiskRead && capability.Exposure == assistant.ExposureAuto {
		return assistant.Decision{Allowed: true, Reason: "safe_read"}
	}
	if mode == assistant.ExecutionReadOnly {
		return assistant.Decision{Reason: "read_only_mode"}
	}
	if mode == assistant.ExecutionFullAuto {
		return assistant.Decision{Allowed: true, Reason: "full_auto"}
	}
	if capability.Exposure == assistant.ExposureProtected || capability.Risk == assistant.RiskDestructive || capability.Risk == assistant.RiskSensitive {
		if approved {
			return assistant.Decision{Allowed: true, Reason: "protected_approved"}
		}
		return assistant.Decision{ConfirmationNeeded: true, Reason: "protected_confirmation_required"}
	}
	if capability.Exposure == assistant.ExposureConfirm || capability.Risk != assistant.RiskRead {
		if approved {
			return assistant.Decision{Allowed: true, Reason: "write_approved"}
		}
		return assistant.Decision{ConfirmationNeeded: true, Reason: "confirmation_required"}
	}
	return assistant.Decision{Allowed: true, Reason: fmt.Sprintf("exposure_%s", capability.Exposure)}
}
