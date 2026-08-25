package server

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	assistantSkillNameLimit        = 80
	assistantSkillDescriptionLimit = 280
	assistantSkillPromptLimit      = 6000
)

type assistantSkill struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Prompt      string    `json:"prompt"`
	Source      string    `json:"source"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type assistantSkillSeed struct {
	Key         string
	Name        string
	Description string
	Prompt      string
}

var defaultAssistantSkillSeeds = []assistantSkillSeed{
	{Key: "service-status", Name: "检查服务状态", Description: "检查 MosDNS 与 Mihomo 是否正常运行并定位异常", Prompt: "检查 MosDNS 和 Mihomo 当前是否正常运行，指出异常并给出处理建议。"},
	{Key: "recent-logs", Name: "分析近期日志", Description: "归纳错误、高频异常和可能原因", Prompt: "分析最近的 MosDNS 与 Mihomo 日志，归纳错误、高频异常和可能原因。"},
	{Key: "proxies-connections", Name: "检查代理与连接", Description: "查看代理组、当前节点、延迟和活跃连接", Prompt: "检查 Mihomo 代理与连接状态。按需读取概览、代理组与节点、活跃连接、Provider 状态和必要的近期日志，由你根据证据完整性自行决定查询深度；已有数据足以形成可靠结论时及时停止。不要逐个测试全部节点或反复查询相同 API；如果只有 COMPATIBLE 占位组、节点为空或订阅尚未加载，直接说明当前未载入有效代理配置，不要为了凑数据继续循环寻找。只分析，不修改配置。"},
	{Key: "dns-rules", Name: "检查 DNS 与规则", Description: "检查查询日志、客户端设置与现有规则", Prompt: "检查 MosDNS 查询日志、客户端设置和现有规则是否合理，先给出分析，不要修改。"},
	{Key: "system-diagnostics", Name: "运行系统诊断", Description: "检查资源、磁盘空间和受管服务", Prompt: "运行系统诊断，检查资源、磁盘空间和受管服务，并汇总异常。"},
	{Key: "assistant-capabilities", Name: "查看助手能力", Description: "读取 MEMORY.md，了解可用工具、模式与安全边界", Prompt: "读取并解释当前 AI 助手的 MEMORY.md。优先依据当前运行时已经加载的 Memory 内容；需要核对文件时，使用 read 读取 MSF 数据目录下 configs/assistant/MEMORY.md。用清晰的中文分组说明：可以查询和操作哪些 MSF 功能、有哪些 API/文件/Shell/Skill 工具、只读/确认/自动三种模式的区别、哪些操作会要求确认、当前限制与安全边界。不要修改任何文件或配置，不要原样倾倒整份 MEMORY.md 或完整 API 路由清单。"},
}

func (a *App) assistantSkillsRoot() string {
	return filepath.Join(a.DataDir, "configs", "assistant", "skills")
}

func (a *App) assistantSkillDir(userID int64, skillID string) (string, error) {
	if !validAssistantSkillID(skillID) {
		return "", fmt.Errorf("invalid assistant skill id")
	}
	return filepath.Join(a.assistantSkillsRoot(), fmt.Sprintf("user-%d", userID), skillID), nil
}

func validAssistantSkillID(value string) bool {
	if value == "" || len(value) > 96 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			continue
		}
		return false
	}
	return true
}

func trimAssistantSkillValue(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

func normalizeAssistantSkillLabel(value string, limit int) string {
	return trimAssistantSkillValue(strings.Join(strings.Fields(value), " "), limit)
}

func (a *App) writeAssistantSkillFile(userID int64, skill assistantSkill) (string, error) {
	dir, err := a.assistantSkillDir(userID, skill.ID)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0750); err != nil {
		return "", err
	}
	content := fmt.Sprintf("---\nname: %q\ndescription: %q\ncontext: inline\n---\n\n# %s\n\n%s\n\n## 执行提示\n\n%s\n", skill.ID, skill.Name+" — "+skill.Description, skill.Name, skill.Description, skill.Prompt)
	finalPath := filepath.Join(dir, "SKILL.md")
	temporary, err := os.CreateTemp(dir, ".SKILL.md.*.tmp")
	if err != nil {
		return "", err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0640); err != nil {
		_ = temporary.Close()
		return "", err
	}
	if _, err := temporary.WriteString(content); err != nil {
		_ = temporary.Close()
		return "", err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return "", err
	}
	if err := temporary.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return "", err
	}
	return finalPath, nil
}

func (a *App) ensureDefaultAssistantSkills(userID int64) error {
	now := time.Now()
	for _, seed := range defaultAssistantSkillSeeds {
		skillID := fmt.Sprintf("skill_default_%d_%s", userID, seed.Key)
		var exists int
		if err := a.DB.QueryRow(`select count(*) from assistant_skills where id=? and user_id=?`, skillID, userID).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			var current assistantSkill
			var deletedAt sql.NullTime
			if err := a.DB.QueryRow(`select id,name,description,prompt,source,created_at,updated_at,deleted_at from assistant_skills where id=? and user_id=?`, skillID, userID).Scan(&current.ID, &current.Name, &current.Description, &current.Prompt, &current.Source, &current.CreatedAt, &current.UpdatedAt, &deletedAt); err != nil {
				return err
			}
			if deletedAt.Valid || current.Source != "default" || current.Name == seed.Name && current.Description == seed.Description && current.Prompt == seed.Prompt {
				continue
			}
			current.Name = seed.Name
			current.Description = seed.Description
			current.Prompt = seed.Prompt
			current.UpdatedAt = now
			filePath, err := a.writeAssistantSkillFile(userID, current)
			if err != nil {
				return err
			}
			if _, err := a.DB.Exec(`update assistant_skills set name=?,description=?,prompt=?,file_path=?,updated_at=? where id=? and user_id=? and source='default' and deleted_at is null`, current.Name, current.Description, current.Prompt, filePath, now, skillID, userID); err != nil {
				return err
			}
			continue
		}
		skill := assistantSkill{
			ID:          skillID,
			Name:        seed.Name,
			Description: seed.Description,
			Prompt:      seed.Prompt,
			Source:      "default",
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		filePath, err := a.writeAssistantSkillFile(userID, skill)
		if err != nil {
			return err
		}
		if _, err := a.DB.Exec(`insert or ignore into assistant_skills(id,user_id,name,description,prompt,source,file_path,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)`, skill.ID, userID, skill.Name, skill.Description, skill.Prompt, skill.Source, filePath, now, now); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) ensureEinoAssistantSkillFiles(userID int64) error {
	if err := a.ensureDefaultAssistantSkills(userID); err != nil {
		return err
	}
	rows, err := a.DB.Query(`select id,name,description,prompt,source,created_at,updated_at from assistant_skills where user_id=? and deleted_at is null`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := make([]assistantSkill, 0)
	for rows.Next() {
		var item assistantSkill
		if err := rows.Scan(&item.ID, &item.Name, &item.Description, &item.Prompt, &item.Source, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range items {
		dir, err := a.assistantSkillDir(userID, item.ID)
		if err != nil {
			return err
		}
		data, readErr := os.ReadFile(filepath.Join(dir, "SKILL.md"))
		if readErr == nil && strings.HasPrefix(strings.TrimSpace(string(data)), "---\n") {
			continue
		}
		if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
			return readErr
		}
		if _, err := a.writeAssistantSkillFile(userID, item); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) listAssistantSkills(userID int64, limit int) ([]assistantSkill, error) {
	if err := a.ensureDefaultAssistantSkills(userID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 50 {
		limit = 50
	}
	rows, err := a.DB.Query(`select id,name,description,prompt,source,created_at,updated_at from assistant_skills where user_id=? and deleted_at is null order by updated_at desc,id asc limit ?`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]assistantSkill, 0, limit)
	for rows.Next() {
		var skill assistantSkill
		if err := rows.Scan(&skill.ID, &skill.Name, &skill.Description, &skill.Prompt, &skill.Source, &skill.CreatedAt, &skill.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, skill)
	}
	return items, rows.Err()
}

func (a *App) createAssistantSkill(userID int64, name, description, promptText string) (assistantSkill, error) {
	if err := a.ensureDefaultAssistantSkills(userID); err != nil {
		return assistantSkill{}, err
	}
	name = normalizeAssistantSkillLabel(name, assistantSkillNameLimit)
	description = normalizeAssistantSkillLabel(description, assistantSkillDescriptionLimit)
	promptText = trimAssistantSkillValue(promptText, assistantSkillPromptLimit)
	if name == "" || promptText == "" {
		return assistantSkill{}, fmt.Errorf("Skill 名称和执行提示不能为空")
	}
	if assistantTextContainsLikelySecret(name + "\n" + description + "\n" + promptText) {
		return assistantSkill{}, fmt.Errorf("Skill 内容疑似包含密钥或密码，已拒绝保存")
	}
	if description == "" {
		description = "管理员保存的自定义 MSF Skill"
	}
	now := time.Now()
	skill := assistantSkill{
		ID:          "skill_" + randomHex(12),
		Name:        name,
		Description: description,
		Prompt:      promptText,
		Source:      "custom",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	filePath, err := a.writeAssistantSkillFile(userID, skill)
	if err != nil {
		return assistantSkill{}, err
	}
	if _, err := a.DB.Exec(`insert into assistant_skills(id,user_id,name,description,prompt,source,file_path,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)`, skill.ID, userID, skill.Name, skill.Description, skill.Prompt, skill.Source, filePath, now, now); err != nil {
		if dir, pathErr := a.assistantSkillDir(userID, skill.ID); pathErr == nil {
			_ = os.RemoveAll(dir)
		}
		return assistantSkill{}, err
	}
	return skill, nil
}

func (a *App) deleteAssistantSkill(userID int64, skillID string) error {
	if !validAssistantSkillID(skillID) {
		return sql.ErrNoRows
	}
	var exists int
	if err := a.DB.QueryRow(`select 1 from assistant_skills where id=? and user_id=? and deleted_at is null`, skillID, userID).Scan(&exists); err != nil {
		return err
	}
	dir, err := a.assistantSkillDir(userID, skillID)
	if err != nil {
		return err
	}
	trashRoot := filepath.Join(a.assistantSkillsRoot(), ".trash")
	if err := os.MkdirAll(trashRoot, 0750); err != nil {
		return err
	}
	trashPath := filepath.Join(trashRoot, fmt.Sprintf("user-%d-%s-%d", userID, skillID, time.Now().UnixNano()))
	moved := false
	if _, statErr := os.Stat(dir); statErr == nil {
		if err := os.Rename(dir, trashPath); err != nil {
			return err
		}
		moved = true
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return statErr
	}
	if _, err := a.DB.Exec(`update assistant_skills set deleted_at=?,updated_at=? where id=? and user_id=? and deleted_at is null`, time.Now(), time.Now(), skillID, userID); err != nil {
		if moved {
			_ = os.Rename(trashPath, dir)
		}
		return err
	}
	return nil
}

func (a *App) handleAssistantSkillsList(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	items, err := a.listAssistantSkills(user.ID, 50)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "assistant_skills_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": items})
}

func (a *App) handleAssistantSkillCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	var request struct {
		Name         string `json:"name"`
		Description  string `json:"description"`
		Prompt       string `json:"prompt"`
		Instructions string `json:"instructions"`
	}
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "assistant_skill_invalid", err.Error())
		return
	}
	if request.Prompt == "" {
		request.Prompt = request.Instructions
	}
	skill, err := a.createAssistantSkill(user.ID, request.Name, request.Description, request.Prompt)
	if err != nil {
		writeError(w, http.StatusBadRequest, "assistant_skill_invalid", err.Error())
		return
	}
	a.audit(user, "assistant.skill.create", skill.ID, skill.Name, true, "")
	writeJSON(w, http.StatusCreated, map[string]any{"success": true, "data": skill})
}

func (a *App) handleAssistantSkillDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := assistantAdmin(r)
	if !ok {
		writeError(w, http.StatusForbidden, "assistant_admin_required", "AI 助手仅管理员可用")
		return
	}
	skillID := strings.TrimSpace(r.PathValue("id"))
	if err := a.deleteAssistantSkill(user.ID, skillID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "assistant_skill_not_found", "Skill 不存在")
			return
		}
		writeError(w, http.StatusInternalServerError, "assistant_skill_delete_failed", err.Error())
		return
	}
	a.audit(user, "assistant.skill.delete", skillID, "", true, "")
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}
