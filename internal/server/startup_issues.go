package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Startup issues decouple "the active Mihomo config is incompatible right now"
// from "the panel must die".  Reconcile failures used to bubble up to
// log.Fatal, which systemd turned into a crash loop with the only repair
// surface (the panel) never coming up.  Instead the failure is recorded here,
// surfaced through GET /api/v1/system/startup-issues with concrete manual fix
// steps, and the panel keeps serving.
const startupIssuesSettingKey = "runtime.startup_issues"

type startupFixStep struct {
	Title       string `json:"title"`
	Detail      string `json:"detail"`
	Command     string `json:"command,omitempty"`
	DownloadURL string `json:"download_url,omitempty"`
	TargetPath  string `json:"target_path,omitempty"`
}

type startupIssue struct {
	Code       string           `json:"code"`
	Title      string           `json:"title"`
	Message    string           `json:"message"`
	DetectedAt string           `json:"detected_at"`
	FixSteps   []startupFixStep `json:"fix_steps"`
}

func (a *App) recordStartupIssue(code, title, message string, steps []startupFixStep) {
	issues := a.startupIssues()
	kept := make([]startupIssue, 0, len(issues)+1)
	for _, issue := range issues {
		if issue.Code != code {
			kept = append(kept, issue)
		}
	}
	kept = append(kept, startupIssue{
		Code:       code,
		Title:      title,
		Message:    message,
		DetectedAt: nowString(),
		FixSteps:   steps,
	})
	a.storeStartupIssues(kept)
	a.LogError("app/startup_issues.go", "启动校验失败，已降级启动（代理可能未运行），请在面板查看修复步骤", map[string]any{
		"code":    code,
		"message": message,
	})
}

func (a *App) clearStartupIssue(code string) {
	issues := a.startupIssues()
	kept := issues[:0]
	for _, issue := range issues {
		if issue.Code != code {
			kept = append(kept, issue)
		}
	}
	if len(kept) == len(issues) {
		return
	}
	a.storeStartupIssues(kept)
}

func (a *App) startupIssues() []startupIssue {
	raw := strings.TrimSpace(a.setting(startupIssuesSettingKey, ""))
	if raw == "" {
		return nil
	}
	var issues []startupIssue
	if json.Unmarshal([]byte(raw), &issues) != nil {
		return nil
	}
	return issues
}

func (a *App) storeStartupIssues(issues []startupIssue) {
	if len(issues) == 0 {
		a.setSetting(startupIssuesSettingKey, "")
		return
	}
	raw, err := json.Marshal(issues)
	if err != nil {
		return
	}
	a.setSetting(startupIssuesSettingKey, string(raw))
}

func (a *App) handleStartupIssues(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]any{"issues": a.startupIssues()},
	})
}

// startupIssueFromValidation maps a reconcile/validation failure to a
// classified issue with fix guidance.  The classification mirrors the checks
// in validateMihomoCandidateContent so each failure mode gets instructions
// that actually resolve it, including the "proxy is down so the panel cannot
// download anything" bootstrap case.
func (a *App) startupIssueFromValidation(message string) startupIssue {
	msg := strings.TrimSpace(message)
	switch {
	case strings.Contains(msg, "Smart 所需资源尚未下载完成"):
		return a.smartResourceStartupIssue(msg)
	case strings.Contains(msg, "Meta 核心配置不支持 Smart"), strings.Contains(msg, "Meta 核心配置中的代理组"):
		return startupIssue{
			Code:  "mihomo_core_type_mismatch",
			Title: "内核类型记录与 Smart 配置不匹配",
			Message: msg + "。通常由旧版本把数据库中的内核类型写回 meta 引起（当前实际二进制可能是 Smart 内核）。" +
				"本版本启动时已按 mihomo -v 自动对账；若仍出现此问题，请按以下步骤处理。",
			FixSteps: []startupFixStep{
				{Title: "方式一：在面板切换内核", Detail: "打开 面板 → 组件更新 → 内核切换，选择 Smart 实验版并确认。切换流程会替换二进制并同步数据库记录。"},
				{Title: "方式二：手动改数据库（面板可用时的兜底）", Detail: "SSH 到本机执行以下命令，把内核类型改回 smart 后重启 msf。仅合法值 meta/smart。", Command: fmt.Sprintf("sqlite3 %s \"update system_setups set mihomo_core_type='smart' where id=(select id from system_setups order by id desc limit 1)\" && systemctl restart msf", filepath.Join(a.DataDir, "database", "msf.db"))},
				{Title: "方式三：回退为 Meta 配置", Detail: "若不想再用 Smart：在 配置管理 → 配置历史 中回滚到不含 Smart 代理组的配置版本。"},
			},
		}
	case strings.Contains(msg, "Mihomo configuration test failed"), strings.Contains(msg, "configuration test timed out"):
		return startupIssue{
			Code:    "mihomo_config_test_failed",
			Title:   "当前 Mihomo 配置无法通过内核自检",
			Message: msg + "。active 配置与内核不兼容，msf 已跳过同步并保持面板可用；mihomo 可能未在运行。",
			FixSteps: []startupFixStep{
				{Title: "查看具体报错", Detail: "展开上方错误信息，定位配置文件中的报错行号（通常为 proxy-providers / proxy-groups / rules 段）。"},
				{Title: "回滚配置", Detail: "打开 配置管理 → 配置历史，回滚到最近一份可用的 mihomo 配置。"},
				{Title: "编辑自定义配置", Detail: "打开 代理配置 → 自定义配置，修正报错字段后重新保存应用（保存时会再次校验）。"},
				{Title: "兜底：清除 applied 状态", Detail: "若无法定位问题，可让 msf 忽略自定义配置、回到生成模式（会保留你的订阅）：", Command: fmt.Sprintf("sqlite3 %s \"delete from settings where key='mihomo.applied_user_config'\" && systemctl restart msf", filepath.Join(a.DataDir, "database", "msf.db"))},
			},
		}
	case strings.Contains(msg, "binary not installed"), strings.Contains(msg, "Mihomo binary"):
		return startupIssue{
			Code:    "mihomo_binary_missing",
			Title:   "Mihomo 内核二进制缺失",
			Message: msg + "。",
			FixSteps: []startupFixStep{
				{Title: "方式一：面板重新下载", Detail: "网络恢复后打开 组件更新 → Mihomo → 下载安装。"},
				{Title: "方式二：手动放置", Detail: fmt.Sprintf("从 GitHub Releases 下载对应架构（x86_64 为 amd64）的 mihomo 压缩包，解压出二进制后放到以下路径并赋予执行权限（文件名必须是 mihomo，不要带版本号）："), DownloadURL: "https://github.com/MetaCubeX/mihomo/releases/latest", TargetPath: filepath.Join(a.DataDir, "data", "binaries", "mihomo", "mihomo"), Command: fmt.Sprintf("chmod +x %s", filepath.Join(a.DataDir, "data", "binaries", "mihomo", "mihomo"))},
			},
		}
	default:
		return startupIssue{
			Code:    "mihomo_config_invalid",
			Title:   "当前 Mihomo 配置未通过启动校验",
			Message: msg + "。msf 已跳过该配置的同步（面板保持可用），请在面板修复后重新应用。",
			FixSteps: []startupFixStep{
				{Title: "检查配置结构", Detail: "打开 代理配置 → 自定义配置，按错误信息修正 YAML（常见：字段拼写、缩进、proxy-groups 引用不存在的节点）。"},
				{Title: "回滚历史版本", Detail: "打开 配置管理 → 配置历史，回滚到最近一份可用的 mihomo 配置。"},
			},
		}
	}
}

// smartResourceStartupIssue covers the incident where the Smart kernel's
// lgbm-auto-update removed Model.bin and the download could not complete
// (or the file was replaced manually without a receipt).  The guidance must
// work while the proxy itself is down, hence the full manual path including
// the "adopt the manually placed file" verify endpoint.
func (a *App) smartResourceStartupIssue(msg string) startupIssue {
	mihomoDir := filepath.Join(a.DataDir, "configs", "mihomo")
	modelTarget := filepath.Join(mihomoDir, "Model.bin")
	asnTarget := filepath.Join(mihomoDir, "ASN.mmdb")
	steps := []startupFixStep{
		{
			Title:       "在 PC 浏览器下载所需资源（无需解压，直接就是数据文件）",
			Detail:      "LightGBM 模型 Model.bin（约 9MB，vernesong 官方发布）与 ASN 数据库 ASN.mmdb。下载页打开后点击对应文件名即可下载。",
			DownloadURL: "https://github.com/vernesong/mihomo/releases/tag/LightGBM-Model",
		},
		{
			Title:   "上传到路由器指定路径（文件名保持不变）",
			Detail:  fmt.Sprintf("在 PC 上执行（按需替换用户名与 IP）。Model.bin → %s；ASN.mmdb → %s。文件放好后无需解压。", modelTarget, asnTarget),
			Command: fmt.Sprintf("scp Model.bin ASN.mmdb <user>@<msf-host>:/tmp/ && ssh <user>@<msf-host> 'su -c \"mv /tmp/Model.bin /tmp/ASN.mmdb %s/\"'", mihomoDir),
		},
		{
			Title:   "在面板认领手动放置的文件",
			Detail:  "打开 面板 → 代理配置 → Smart 资源，点击「校验并认领」。MSF 会对已放置的文件计算 SHA-256 并写入回执（等同于下载完成），无需重新下载。也可以直接调用下方接口。",
			Command: "curl -X POST http://127.0.0.1:7777/api/v1/mihomo/smart-resources/verify -H 'Content-Type: application/json' -d '{\"resources\":[\"lightgbm\",\"asn\"]}'",
		},
		{
			Title:   "重启生效",
			Detail:  "认领成功后重启 msf（或等 A3 自愈拉起 mihomo）。若网络已恢复，也可以直接在 Smart 资源页点「下载」由 MSF 自动完成。",
			Command: "systemctl restart msf",
		},
	}
	return startupIssue{
		Code:     "mihomo_smart_resources_missing",
		Title:    "Smart 内核所需资源缺失或未通过校验",
		Message:  msg + "。若当前代理已断（下载走不通），请按步骤手动下载放置——这正是本指引覆盖的场景。",
		FixSteps: steps,
	}
}

// handleMihomoSmartResourceVerify adopts a manually placed Smart resource
// file: it hashes the file on disk and writes the receipt so the resource is
// treated as installed without a fresh download.  This is the recovery path
// for "the proxy is down so MSF cannot download its own model".
func (a *App) handleMihomoSmartResourceVerify(w http.ResponseWriter, r *http.Request) {
	keys, ok := decodeSmartResourceKeys(w, r)
	if !ok {
		return
	}
	specs := mihomoSmartResourceSpecs()
	verified := make([]string, 0, len(keys))
	failed := make(map[string]string, len(keys))
	for _, key := range keys {
		spec, exists := specs[key]
		if !exists {
			writeError(w, http.StatusBadRequest, "unknown_smart_resource", "unknown Smart resource "+key)
			return
		}
		target := a.smartResourceTarget(spec)
		info, err := os.Stat(target)
		if err != nil || info.Size() == 0 {
			failed[key] = "文件不存在或为空：" + target
			continue
		}
		digest, err := hashFileSHA256(target)
		if err != nil {
			failed[key] = "计算 SHA-256 失败：" + err.Error()
			continue
		}
		receipt := smartResourceReceipt{
			Digest:             digest,
			Size:               info.Size(),
			SourceURL:          spec.Source,
			VerificationSource: "manual_adoption",
			InstalledAt:        time.Now(),
			FileModTimeUnixNS:  info.ModTime().UnixNano(),
		}
		if err := writeSmartResourceReceipt(smartResourceReceiptPath(target), receipt); err != nil {
			failed[key] = "写入回执失败：" + err.Error()
			continue
		}
		verified = append(verified, key)
	}
	a.clearStartupIssue("mihomo_smart_resources_missing")
	status := http.StatusOK
	if len(verified) == 0 {
		status = http.StatusConflict
	}
	writeJSON(w, status, map[string]any{
		"success": len(failed) == 0,
		"data": map[string]any{
			"verified":  verified,
			"failed":    failed,
			"resources": a.smartResourceStates(),
		},
	})
}

func hashFileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}
