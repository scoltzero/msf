package server

import (
	"os"
	"strings"
	"testing"
)

func TestAssistantRuntimeMemoryIsCreatedAndPreservesCustomNotes(t *testing.T) {
	app := newTestApp(t)
	memory, err := app.loadAssistantMemory()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(memory, "MSF 管理员 AI 助手记忆") {
		t.Fatalf("default runtime memory was not created: %s", memory)
	}
	custom := memory + "\n管理员约定：诊断时先读取状态。\n"
	if err := os.WriteFile(app.assistantMemoryPath(), []byte(custom), 0640); err != nil {
		t.Fatal(err)
	}
	loaded, err := app.loadAssistantMemory()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(loaded, "管理员约定：诊断时先读取状态") {
		t.Fatalf("custom memory note was not preserved: %s", loaded)
	}
}

func TestAssistantRuntimeMemoryRejectsLikelySecrets(t *testing.T) {
	app := newTestApp(t)
	memory, err := app.loadAssistantMemory()
	if err != nil {
		t.Fatal(err)
	}
	memory += "\napi_key=super-secret-value\n"
	if err := os.WriteFile(app.assistantMemoryPath(), []byte(memory), 0640); err != nil {
		t.Fatal(err)
	}
	if _, err := app.loadAssistantMemory(); err == nil || !strings.Contains(err.Error(), "possible secret") {
		t.Fatalf("runtime memory secret was accepted: %v", err)
	}
}
