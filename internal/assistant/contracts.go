// Package assistant contains the provider-neutral contracts for the MSF
// administrator assistant.  This first layer deliberately has no HTTP, model,
// or database dependency; it can be tested before the assistant is exposed.
package assistant

// Exposure controls whether an API capability may be executed automatically.
type Exposure string

const (
	ExposureAuto      Exposure = "auto"
	ExposureConfirm   Exposure = "confirm"
	ExposureProtected Exposure = "protected"
	ExposureInternal  Exposure = "internal"
)

// Risk describes the operational impact of a capability.
type Risk string

const (
	RiskRead        Risk = "read"
	RiskReversible  Risk = "reversible_write"
	RiskDestructive Risk = "destructive_write"
	RiskSensitive   Risk = "sensitive"
)

// ExecutionMode is the administrator-selected write policy.
type ExecutionMode string

const (
	ExecutionReadOnly      ExecutionMode = "read_only"
	ExecutionConfirmWrites ExecutionMode = "confirm_writes"
	ExecutionFullAuto      ExecutionMode = "full_auto"
)

func NormalizeExecutionMode(mode ExecutionMode) ExecutionMode {
	switch mode {
	case ExecutionReadOnly, ExecutionConfirmWrites, ExecutionFullAuto:
		return mode
	default:
		return ExecutionConfirmWrites
	}
}

// APICall is the model-facing generic MSF API call.  Path and method are
// resolved against catalog.Capability entries before any handler is reached.
type APICall struct {
	Method string         `json:"method"`
	Path   string         `json:"path"`
	Query  map[string]any `json:"query,omitempty"`
	Body   any            `json:"body,omitempty"`
}

// Decision is the result of applying execution mode and capability policy.
type Decision struct {
	Allowed            bool
	ConfirmationNeeded bool
	Reason             string
}
