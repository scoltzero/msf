package server

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	manualAcceleratorProbeTarget  = "https://raw.githubusercontent.com/scoltzero/msf/main/README.md"
	manualAcceleratorProbeTimeout = 6 * time.Second
)

const (
	settingGitHubToken           = "github_token" // legacy plaintext key; migrated at startup
	settingGitHubTokenCiphertext = "github_token_ciphertext"
	settingGitHubTokenNonce      = "github_token_nonce"
)

// manualAcceleratorPrefix returns only the accelerator URL explicitly saved
// by the operator. MSF does not provide, probe, rank, or select mirror URLs.
func (a *App) manualAcceleratorPrefix() string {
	var enabled bool
	var manual sql.NullString
	if err := a.DB.QueryRow(`select github_accelerator_enabled,github_accelerator_url from system_setups order by id desc limit 1`).Scan(&enabled, &manual); err != nil || !enabled {
		return ""
	}
	prefix := strings.TrimRight(strings.TrimSpace(manual.String), "/")
	if !strings.HasPrefix(prefix, "https://") && !strings.HasPrefix(prefix, "http://") {
		return ""
	}
	return prefix
}

type manualAcceleratorProbeResult struct {
	Prefix    string    `json:"prefix"`
	OK        bool      `json:"ok"`
	LatencyMS int64     `json:"latency_ms"`
	Status    int       `json:"status,omitempty"`
	Error     string    `json:"error,omitempty"`
	ProbedAt  time.Time `json:"probed_at"`
}

func (a *App) githubDownloadRouteName() string {
	if a.downloadProxyURL() != nil {
		return "proxy"
	}
	if a.manualAcceleratorPrefix() != "" {
		return "manual"
	}
	if a.runningMihomoDownloadProxyURL() != nil {
		return "mihomo"
	}
	return "github"
}

// probeManualAccelerator checks only the single URL entered by the operator.
// It never discovers alternatives, changes routing, stores a winner, or sends
// the GitHub token to the accelerator.
func (a *App) probeManualAccelerator(ctx context.Context) manualAcceleratorProbeResult {
	prefix := a.manualAcceleratorPrefix()
	result := manualAcceleratorProbeResult{Prefix: prefix, ProbedAt: time.Now()}
	if prefix == "" {
		result.Error = "尚未配置手动加速源"
		return result
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	client := &http.Client{Timeout: manualAcceleratorProbeTimeout, Transport: transport}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, prefix+"/"+manualAcceleratorProbeTarget, nil)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	req.Header.Set("Range", "bytes=0-2047")
	req.Header.Set("User-Agent", "msf-manual-accelerator-check/1.0")
	started := time.Now()
	resp, err := client.Do(req)
	result.LatencyMS = time.Since(started).Milliseconds()
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer resp.Body.Close()
	result.Status = resp.StatusCode
	written, readErr := io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if readErr != nil {
		result.Error = readErr.Error()
		return result
	}
	if (resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent) || written <= 100 {
		result.Error = "加速源未返回有效内容"
		return result
	}
	result.OK = true
	return result
}

// handleGitHubAccelerators retains the authenticated token endpoint and a
// backwards-compatible manual-prefix setter. Automatic mirror discovery was
// intentionally removed: every accelerator URL must come from the operator.
func (a *App) handleGitHubAccelerators(w http.ResponseWriter, r *http.Request) {
	var probe *manualAcceleratorProbeResult
	if r.Method == http.MethodPost {
		checked := a.probeManualAccelerator(r.Context())
		probe = &checked
	}
	if r.Method == http.MethodPut {
		var body struct {
			ManualPrefix *string `json:"manual_prefix"`
			GitHubToken  string  `json:"github_token"`
			ResetToken   bool    `json:"reset_token"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "invalid request body: " + err.Error()})
			return
		}
		if body.ManualPrefix != nil {
			manual := strings.TrimRight(strings.TrimSpace(*body.ManualPrefix), "/")
			if manual != "" && !(strings.HasPrefix(manual, "https://") || strings.HasPrefix(manual, "http://")) {
				writeJSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "manual prefix must start with http:// or https://"})
				return
			}
			if _, err := a.DB.Exec(`update system_setups set github_accelerator_enabled=?, github_accelerator_url=? where id=(select id from system_setups order by id desc limit 1)`, manual != "", manual); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": "save manual prefix: " + err.Error()})
				return
			}
		}
		if body.ResetToken {
			if err := a.clearGitHubToken(); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": "clear GitHub token: " + err.Error()})
				return
			}
		} else if strings.TrimSpace(body.GitHubToken) != "" {
			token := strings.TrimSpace(body.GitHubToken)
			if len(token) < 16 || len(token) > 255 {
				writeJSON(w, http.StatusBadRequest, map[string]any{"success": false, "error": "github token length looks invalid"})
				return
			}
			if err := a.saveGitHubToken(token); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"success": false, "error": "save GitHub token: " + err.Error()})
				return
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"manual_prefix":       a.manualAcceleratorPrefix(),
		"current_route":       a.githubDownloadRouteName(),
		"probe":               probe,
		"github_token_masked": maskGitHubToken(a.githubToken()),
		"rate_limit":          lastGitHubRateLimit.snapshot(),
	}})
}

// migrateGitHubTokenStorage moves the short-lived plaintext representation
// used by early PR builds into the same AES-GCM protected local secret store
// as the assistant API key. The migration runs before the HTTP server starts.
func (a *App) migrateGitHubTokenStorage() error {
	legacy := strings.TrimSpace(a.setting(settingGitHubToken, ""))
	if legacy == "" {
		return nil
	}
	var encrypted string
	if err := a.DB.QueryRow(`select value from settings where key=?`, settingGitHubTokenCiphertext).Scan(&encrypted); err == nil && strings.TrimSpace(encrypted) != "" {
		_, err = a.DB.Exec(`delete from settings where key=?`, settingGitHubToken)
		return err
	}
	return a.saveGitHubToken(legacy)
}

func (a *App) saveGitHubToken(token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return a.clearGitHubToken()
	}
	cipherText, nonce, err := a.encryptAssistantSecret(token)
	if err != nil {
		return err
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now()
	for key, value := range map[string]string{
		settingGitHubTokenCiphertext: base64.RawStdEncoding.EncodeToString(cipherText),
		settingGitHubTokenNonce:      base64.RawStdEncoding.EncodeToString(nonce),
	} {
		if _, err := tx.Exec(`insert or replace into settings(key,value,updated_at) values(?,?,?)`, key, value, now); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`delete from settings where key=?`, settingGitHubToken); err != nil {
		return err
	}
	return tx.Commit()
}

func (a *App) clearGitHubToken() error {
	_, err := a.DB.Exec(`delete from settings where key in (?,?,?)`, settingGitHubToken, settingGitHubTokenCiphertext, settingGitHubTokenNonce)
	return err
}

// githubToken returns the optional Personal Access Token used for
// api.github.com quota. Never send it through an accelerator mirror.
func (a *App) githubToken() string {
	if a == nil || a.DB == nil {
		return ""
	}
	var cipherTextText, nonceText string
	err := a.DB.QueryRow(`select c.value,n.value from settings c join settings n on n.key=? where c.key=?`, settingGitHubTokenNonce, settingGitHubTokenCiphertext).Scan(&cipherTextText, &nonceText)
	if err == nil {
		cipherText, decodeCipherErr := base64.RawStdEncoding.DecodeString(cipherTextText)
		nonce, decodeNonceErr := base64.RawStdEncoding.DecodeString(nonceText)
		if decodeCipherErr == nil && decodeNonceErr == nil {
			if token, decryptErr := a.decryptAssistantSecret(cipherText, nonce); decryptErr == nil {
				return strings.TrimSpace(token)
			}
		}
	}
	return ""
}

func maskGitHubToken(token string) string {
	if token = strings.TrimSpace(token); token == "" {
		return ""
	}
	if len(token) <= 8 {
		return strings.Repeat("*", 4)
	}
	return token[:4] + strings.Repeat("*", 6) + token[len(token)-4:]
}

// githubRateLimitObservation remembers the X-RateLimit headers of the most
// recent api.github.com response so the panel can show how much anonymous
// quota the current egress IP has left.
type githubRateLimitObservation struct {
	mu         sync.Mutex
	limit      int64
	remaining  int64
	resetUnix  int64
	via        string
	observedAt time.Time
}

var lastGitHubRateLimit = &githubRateLimitObservation{}

func (o *githubRateLimitObservation) record(resp *http.Response, via string) {
	if resp == nil {
		return
	}
	limit, err1 := strconv.ParseInt(resp.Header.Get("X-RateLimit-Limit"), 10, 64)
	remaining, err2 := strconv.ParseInt(resp.Header.Get("X-RateLimit-Remaining"), 10, 64)
	reset, err3 := strconv.ParseInt(resp.Header.Get("X-RateLimit-Reset"), 10, 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return
	}
	o.mu.Lock()
	o.limit, o.remaining, o.resetUnix, o.via, o.observedAt = limit, remaining, reset, via, time.Now()
	o.mu.Unlock()
}

func (o *githubRateLimitObservation) snapshot() map[string]any {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.observedAt.IsZero() {
		return nil
	}
	return map[string]any{
		"limit":       o.limit,
		"remaining":   o.remaining,
		"reset_unix":  o.resetUnix,
		"via":         o.via,
		"observed_at": o.observedAt,
	}
}
