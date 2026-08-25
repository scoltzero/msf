package catalog

import (
	"embed"
	"fmt"
	"net/url"
	"strings"

	"github.com/scoltzero/msf/internal/assistant"
	"gopkg.in/yaml.v3"
)

//go:embed api_capabilities.yaml routes.txt
var defaultCatalogFS embed.FS

// Capability is the machine-enforced and prompt-visible description of one
// existing MSF API operation.
type Capability struct {
	Name           string             `yaml:"name" json:"name"`
	Method         string             `yaml:"method" json:"method"`
	Path           string             `yaml:"path" json:"path"`
	Description    string             `yaml:"description" json:"description"`
	Exposure       assistant.Exposure `yaml:"exposure" json:"exposure"`
	Risk           assistant.Risk     `yaml:"risk" json:"risk"`
	RequiredRole   string             `yaml:"required_role" json:"required_role"`
	ResultLimit    int                `yaml:"result_limit" json:"result_limit"`
	RedactProfile  string             `yaml:"redact_profile" json:"redact_profile"`
	QuerySchema    map[string]string  `yaml:"query_schema,omitempty" json:"query_schema,omitempty"`
	BodyProperties map[string]string  `yaml:"body_properties,omitempty" json:"body_properties,omitempty"`
}

// Catalog is an immutable snapshot used for matching calls and rendering the
// assistant MEMORY section.
type Catalog struct {
	Capabilities []Capability
}

// Default returns the checked-in explicit capability snapshot.
func Default() (Catalog, error) {
	data, err := defaultCatalogFS.ReadFile("api_capabilities.yaml")
	if err != nil {
		return Catalog{}, fmt.Errorf("read assistant catalog: %w", err)
	}
	var capabilities []Capability
	if err := yaml.Unmarshal(data, &capabilities); err != nil {
		return Catalog{}, fmt.Errorf("decode assistant catalog: %w", err)
	}
	catalog := Catalog{Capabilities: capabilities}
	if err := catalog.Validate(); err != nil {
		return Catalog{}, err
	}
	return catalog, nil
}

// Validate checks invariants before a catalog is accepted by the runtime.
func (c Catalog) Validate() error {
	seen := make(map[string]struct{}, len(c.Capabilities))
	for _, capability := range c.Capabilities {
		if strings.TrimSpace(capability.Name) == "" {
			return fmt.Errorf("assistant capability name is required")
		}
		if _, ok := seen[capability.Name]; ok {
			return fmt.Errorf("duplicate assistant capability: %s", capability.Name)
		}
		seen[capability.Name] = struct{}{}
		method := strings.ToUpper(strings.TrimSpace(capability.Method))
		if method != "GET" && method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
			return fmt.Errorf("invalid method for %s: %q", capability.Name, capability.Method)
		}
		if _, err := normalizePath(capability.Path); err != nil {
			return fmt.Errorf("invalid path for %s: %w", capability.Name, err)
		}
		if capability.RequiredRole == "" {
			return fmt.Errorf("required_role is missing for %s", capability.Name)
		}
		if capability.ResultLimit <= 0 {
			return fmt.Errorf("result_limit must be positive for %s", capability.Name)
		}
	}
	return nil
}

// Match resolves a model call to an exact capability or a path-template
// capability.  It never accepts an absolute URL or a path outside /api/v1/.
func (c Catalog) Match(call assistant.APICall) (Capability, bool, error) {
	method := strings.ToUpper(strings.TrimSpace(call.Method))
	path, err := normalizePath(call.Path)
	if err != nil {
		return Capability{}, false, err
	}
	for _, capability := range c.Capabilities {
		if strings.ToUpper(capability.Method) != method {
			continue
		}
		if pathMatches(capability.Path, path) {
			return capability, true, nil
		}
	}
	return Capability{}, false, nil
}

// PromptLines renders concise capability lines for the assistant MEMORY.
func (c Catalog) PromptLines() []string {
	lines := make([]string, 0, len(c.Capabilities))
	for _, capability := range c.Capabilities {
		lines = append(lines, fmt.Sprintf("- %s: %s %s (%s, %s) - %s", capability.Name, strings.ToUpper(capability.Method), capability.Path, capability.Exposure, capability.Risk, capability.Description))
	}
	return lines
}

// RegisteredRoutes returns the generated inventory extracted from the current
// Go ServeMux registrations. It is used for on-demand capability discovery.
func RegisteredRoutes() ([]string, error) {
	data, err := defaultCatalogFS.ReadFile("routes.txt")
	if err != nil {
		return nil, fmt.Errorf("read assistant route inventory: %w", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		if value := strings.TrimSpace(line); value != "" {
			result = append(result, value)
		}
	}
	return result, nil
}

func normalizePath(raw string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" || !strings.HasPrefix(path, "/api/v1/") {
		return "", fmt.Errorf("path must start with /api/v1/")
	}
	if strings.Contains(path, "://") || strings.Contains(path, "#") || strings.Contains(path, "..") {
		return "", fmt.Errorf("path contains a forbidden URL or traversal component")
	}
	parsed, err := url.ParseRequestURI(path)
	if err != nil || parsed.IsAbs() || parsed.Host != "" {
		return "", fmt.Errorf("path is not a relative API path")
	}
	clean, err := url.PathUnescape(parsed.EscapedPath())
	if err != nil {
		return "", fmt.Errorf("path contains invalid escaping")
	}
	if clean == "" {
		return "", fmt.Errorf("path is empty")
	}
	for _, part := range strings.Split(clean, "/") {
		if part == "." || part == ".." {
			return "", fmt.Errorf("path contains a traversal component")
		}
	}
	return strings.TrimSuffix(clean, "/"), nil
}

func pathMatches(pattern, actual string) bool {
	patternParts := strings.Split(strings.Trim(strings.TrimSpace(pattern), "/"), "/")
	actualParts := strings.Split(strings.Trim(actual, "/"), "/")
	if len(patternParts) != len(actualParts) {
		return false
	}
	for index, patternPart := range patternParts {
		if strings.HasPrefix(patternPart, "{") && strings.HasSuffix(patternPart, "}") {
			if actualParts[index] == "" {
				return false
			}
			continue
		}
		if patternPart != actualParts[index] {
			return false
		}
	}
	return true
}
