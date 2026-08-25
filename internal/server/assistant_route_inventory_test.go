package server

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"testing"

	"github.com/scoltzero/msf/internal/assistant/catalog"
)

func TestAssistantRouteInventoryMatchesRegisteredSource(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot locate server source directory")
	}
	serverDir := filepath.Dir(sourceFile)
	pattern := regexp.MustCompile(`mux\.HandleFunc\("([A-Z]+ /api/v1/[^" ]+)`)
	expected := map[string]struct{}{}
	entries, err := os.ReadDir(serverDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".go" {
			continue
		}
		body, readErr := os.ReadFile(filepath.Join(serverDir, entry.Name()))
		if readErr != nil {
			t.Fatal(readErr)
		}
		for _, match := range pattern.FindAllStringSubmatch(string(body), -1) {
			expected[match[1]] = struct{}{}
		}
	}
	actualList, err := catalog.RegisteredRoutes()
	if err != nil {
		t.Fatal(err)
	}
	actual := map[string]struct{}{}
	for _, route := range actualList {
		actual[route] = struct{}{}
	}
	var missing, stale []string
	for route := range expected {
		if _, ok := actual[route]; !ok {
			missing = append(missing, route)
		}
	}
	for route := range actual {
		if _, ok := expected[route]; !ok {
			stale = append(stale, route)
		}
	}
	sort.Strings(missing)
	sort.Strings(stale)
	if len(missing) > 0 || len(stale) > 0 {
		t.Fatalf("assistant route inventory drift: missing=%v stale=%v", missing, stale)
	}
}
