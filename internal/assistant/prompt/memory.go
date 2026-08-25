package prompt

import (
	_ "embed"
	"fmt"
	"strings"

	"github.com/scoltzero/msf/internal/assistant/catalog"
)

//go:embed MEMORY.md
var defaultMemory string

const (
	generatedStart = "<!-- BEGIN MSF AUTO API CAPABILITIES -->"
	generatedEnd   = "<!-- END MSF AUTO API CAPABILITIES -->"
)

// DefaultMemory returns the checked-in administrator guidance.
func DefaultMemory() string {
	return defaultMemory
}

// RenderMemory replaces only the generated capability interval.  Administrator
// notes outside the interval are preserved by the runtime file updater.
func RenderMemory(base string, capabilityCatalog catalog.Catalog) (string, error) {
	start := strings.Index(base, generatedStart)
	endOffset := strings.Index(base, generatedEnd)
	if start < 0 || endOffset < 0 || endOffset < start {
		return "", fmt.Errorf("assistant MEMORY capability markers are missing")
	}
	end := endOffset + len(generatedEnd)
	lines := strings.Join(capabilityCatalog.PromptLines(), "\n")
	replacement := generatedStart + "\n" + lines + "\n" + generatedEnd
	return base[:start] + replacement + base[end:], nil
}
