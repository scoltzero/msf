package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/scoltzero/msf/internal/assistant"
	"github.com/scoltzero/msf/internal/assistant/catalog"
)

func TestAssistantSkillsArePerAdminAndPersistedAsSkillFiles(t *testing.T) {
	app := newTestApp(t)
	adminToken := tokenForRole(t, app, "admin")
	viewerToken := tokenForRole(t, app, "viewer")
	adminID := mustUserIDFromTokenTest(t, app, adminToken)

	if response := requestJSON(t, app, http.MethodGet, "/api/v1/assistant/skills", viewerToken, nil); response.Code != http.StatusForbidden {
		t.Fatalf("viewer skill list status=%d body=%s", response.Code, response.Body.String())
	}
	response := requestJSON(t, app, http.MethodGet, "/api/v1/assistant/skills", adminToken, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("skill list status=%d body=%s", response.Code, response.Body.String())
	}
	var listPayload struct {
		Data []assistantSkill `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &listPayload); err != nil {
		t.Fatal(err)
	}
	if len(listPayload.Data) != 6 {
		t.Fatalf("default skills=%d want=6", len(listPayload.Data))
	}
	foundCapabilities := false
	for _, skill := range listPayload.Data {
		if skill.Name == "查看助手能力" && strings.Contains(skill.Prompt, "MEMORY.md") {
			foundCapabilities = true
		}
		dir, err := app.assistantSkillDir(adminID, skill.ID)
		if err != nil {
			t.Fatal(err)
		}
		content, err := os.ReadFile(filepath.Join(dir, "SKILL.md"))
		if err != nil {
			t.Fatalf("read skill file %s: %v", skill.ID, err)
		}
		if !strings.Contains(string(content), skill.Name) || !strings.Contains(string(content), skill.Prompt) {
			t.Fatalf("skill file does not contain indexed content: %s", content)
		}
		if !strings.HasPrefix(strings.TrimSpace(string(content)), "---\n") || !strings.Contains(string(content), "context: inline") {
			t.Fatalf("skill file is not Eino-compatible: %s", content)
		}
	}
	if !foundCapabilities {
		t.Fatal("default capability-display Skill is missing")
	}
}

func TestAssistantCustomSkillCreateListAndRecoverableDelete(t *testing.T) {
	app := newTestApp(t)
	adminToken := tokenForRole(t, app, "admin")
	adminID := mustUserIDFromTokenTest(t, app, adminToken)
	create := requestJSON(t, app, http.MethodPost, "/api/v1/assistant/skills", adminToken, map[string]any{
		"name":        "检查 Fake-IP",
		"description": "核对 Fake-IP 配置与运行状态",
		"prompt":      "读取当前 Fake-IP 配置和相关日志，只分析，不要修改。",
	})
	if create.Code != http.StatusCreated {
		t.Fatalf("skill create status=%d body=%s", create.Code, create.Body.String())
	}
	var createPayload struct {
		Data assistantSkill `json:"data"`
	}
	if err := json.Unmarshal(create.Body.Bytes(), &createPayload); err != nil {
		t.Fatal(err)
	}
	if createPayload.Data.Source != "custom" || createPayload.Data.ID == "" {
		t.Fatalf("unexpected created skill: %#v", createPayload.Data)
	}
	dir, err := app.assistantSkillDir(adminID, createPayload.Data.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "SKILL.md")); err != nil {
		t.Fatalf("custom skill file missing: %v", err)
	}

	remove := requestJSON(t, app, http.MethodDelete, "/api/v1/assistant/skills/"+createPayload.Data.ID, adminToken, nil)
	if remove.Code != http.StatusOK {
		t.Fatalf("skill delete status=%d body=%s", remove.Code, remove.Body.String())
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("deleted skill directory still present: %v", err)
	}
	trashEntries, err := os.ReadDir(filepath.Join(app.assistantSkillsRoot(), ".trash"))
	if err != nil {
		t.Fatal(err)
	}
	foundTrash := false
	for _, entry := range trashEntries {
		if strings.Contains(entry.Name(), createPayload.Data.ID) {
			foundTrash = true
			break
		}
	}
	if !foundTrash {
		t.Fatalf("deleted skill was not moved to trash")
	}
}

func TestAssistantSkillAPIsAreCatalogedForModelUse(t *testing.T) {
	catalogSnapshot, err := catalog.Default()
	if err != nil {
		t.Fatal(err)
	}
	for _, call := range []assistant.APICall{
		{Method: http.MethodGet, Path: "/api/v1/assistant/skills"},
		{Method: http.MethodPost, Path: "/api/v1/assistant/skills"},
		{Method: http.MethodDelete, Path: "/api/v1/assistant/skills/skill_example"},
	} {
		if _, matched, matchErr := catalogSnapshot.Match(call); matchErr != nil || !matched {
			t.Fatalf("skill API is not cataloged: %s %s err=%v", call.Method, call.Path, matchErr)
		}
	}
}

func TestAssistantDefaultSkillSeedingRepairsPartialStateWithoutResurrectingDeletedSkills(t *testing.T) {
	app := newTestApp(t)
	adminToken := tokenForRole(t, app, "admin")
	adminID := mustUserIDFromTokenTest(t, app, adminToken)
	if err := app.ensureDefaultAssistantSkills(adminID); err != nil {
		t.Fatal(err)
	}
	missingID := "skill_default_" + fmt.Sprint(adminID) + "_recent-logs"
	missingDir, err := app.assistantSkillDir(adminID, missingID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.DB.Exec(`delete from assistant_skills where id=? and user_id=?`, missingID, adminID); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(missingDir); err != nil {
		t.Fatal(err)
	}
	deletedID := "skill_default_" + fmt.Sprint(adminID) + "_dns-rules"
	if err := app.deleteAssistantSkill(adminID, deletedID); err != nil {
		t.Fatal(err)
	}
	if err := app.ensureDefaultAssistantSkills(adminID); err != nil {
		t.Fatal(err)
	}
	var active int
	if err := app.DB.QueryRow(`select count(*) from assistant_skills where user_id=? and deleted_at is null`, adminID).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 5 {
		t.Fatalf("active defaults=%d want=5 after one repair and one explicit delete", active)
	}
	if _, err := os.Stat(filepath.Join(missingDir, "SKILL.md")); err != nil {
		t.Fatalf("missing default was not repaired: %v", err)
	}
}

func TestAssistantDefaultSkillSeedingUpdatesRuntimeOwnedPrompt(t *testing.T) {
	app := newTestApp(t)
	adminToken := tokenForRole(t, app, "admin")
	adminID := mustUserIDFromTokenTest(t, app, adminToken)
	if err := app.ensureDefaultAssistantSkills(adminID); err != nil {
		t.Fatal(err)
	}
	skillID := "skill_default_" + fmt.Sprint(adminID) + "_proxies-connections"
	if _, err := app.DB.Exec(`update assistant_skills set prompt='stale prompt' where id=? and user_id=?`, skillID, adminID); err != nil {
		t.Fatal(err)
	}
	if err := app.ensureDefaultAssistantSkills(adminID); err != nil {
		t.Fatal(err)
	}
	var promptText string
	if err := app.DB.QueryRow(`select prompt from assistant_skills where id=? and user_id=?`, skillID, adminID).Scan(&promptText); err != nil {
		t.Fatal(err)
	}
	if promptText == "stale prompt" || !strings.Contains(promptText, "根据证据完整性自行决定查询深度") || strings.Contains(promptText, "最多进行 8 次") {
		t.Fatalf("default proxy skill was not synchronized: %q", promptText)
	}
	data, err := os.ReadFile(filepath.Join(app.assistantSkillsRoot(), fmt.Sprintf("user-%d", adminID), skillID, "SKILL.md"))
	if err != nil || !strings.Contains(string(data), "根据证据完整性自行决定查询深度") || strings.Contains(string(data), "最多进行 8 次") {
		t.Fatalf("synchronized SKILL.md content=%q err=%v", data, err)
	}
}

func TestAssistantSkillRejectsLikelySecrets(t *testing.T) {
	app := newTestApp(t)
	adminToken := tokenForRole(t, app, "admin")
	adminID := mustUserIDFromTokenTest(t, app, adminToken)
	if _, err := app.createAssistantSkill(adminID, "unsafe", "contains secret", "api_key=super-secret-value"); err == nil {
		t.Fatal("skill containing a likely secret was accepted")
	}
}

func TestAssistantEinoSkillBackendLoadsOnlyCurrentAdmin(t *testing.T) {
	app := newTestApp(t)
	adminToken := tokenForRole(t, app, "admin")
	otherToken := tokenForRole(t, app, "viewer")
	adminID := mustUserIDFromTokenTest(t, app, adminToken)
	otherID := mustUserIDFromTokenTest(t, app, otherToken)
	created, err := app.createAssistantSkill(adminID, "Eino Skill", "runtime skill", "只读取状态并输出摘要。")
	if err != nil {
		t.Fatal(err)
	}
	backend := &assistantEinoSkillBackend{app: app, userID: adminID}
	items, err := backend.List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range items {
		if item.Name == created.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("Eino backend did not expose created skill: %#v", items)
	}
	loaded, err := backend.Get(t.Context(), created.ID)
	if err != nil || loaded.Content != created.Prompt {
		t.Fatalf("Eino skill load=%#v err=%v", loaded, err)
	}
	if _, err := (&assistantEinoSkillBackend{app: app, userID: otherID}).Get(t.Context(), created.ID); err == nil {
		t.Fatal("another admin could load the first admin's Eino skill")
	}
}
