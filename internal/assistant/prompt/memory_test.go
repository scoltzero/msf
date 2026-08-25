package prompt

import (
	"strings"
	"testing"

	"github.com/scoltzero/msf/internal/assistant/catalog"
)

func TestRenderMemoryPreservesCustomNotes(t *testing.T) {
	c, err := catalog.Default()
	if err != nil {
		t.Fatal(err)
	}
	rendered, err := RenderMemory(DefaultMemory()+"\n管理员备注：只使用本机服务。\n", c)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rendered, "管理员备注：只使用本机服务。") {
		t.Fatal("custom memory note was not preserved")
	}
	if !strings.Contains(rendered, "service_restart: POST /api/v1/services/{name}/restart") {
		t.Fatal("catalog capability was not rendered")
	}
}
