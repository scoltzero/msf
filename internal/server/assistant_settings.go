package server

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/scoltzero/msf/internal/assistant"
)

type assistantSettings struct {
	Enabled        bool
	Provider       string
	BaseURL        string
	APIKey         string
	APIKeySet      bool
	Model          string
	Protocol       string
	ContextTokens  int
	Temperature    float64
	RequestTimeout int
	MaxToolRounds  int
	ExecutionMode  assistant.ExecutionMode
	ShowToolDetail bool
	OrbEnabled     bool
}

type assistantSettingsPatch struct {
	Enabled        *bool                    `json:"enabled"`
	Provider       *string                  `json:"provider"`
	BaseURL        *string                  `json:"base_url"`
	APIKey         *string                  `json:"api_key"`
	Model          *string                  `json:"model"`
	Protocol       *string                  `json:"protocol"`
	ContextTokens  *int                     `json:"context_tokens"`
	Temperature    *float64                 `json:"temperature"`
	RequestTimeout *int                     `json:"request_timeout"`
	MaxToolRounds  *int                     `json:"max_tool_rounds"`
	ExecutionMode  *assistant.ExecutionMode `json:"execution_mode"`
	ShowToolDetail *bool                    `json:"show_tool_details"`
	OrbEnabled     *bool                    `json:"orb_enabled"`
}

func defaultAssistantSettings() assistantSettings {
	return assistantSettings{
		Provider:       "openai_compatible",
		Protocol:       "chat_completions",
		ContextTokens:  32000,
		Temperature:    0.2,
		RequestTimeout: 60,
		MaxToolRounds:  8,
		ExecutionMode:  assistant.ExecutionConfirmWrites,
		ShowToolDetail: true,
		OrbEnabled:     true,
	}
}

func (a *App) getAssistantSettings() (assistantSettings, error) {
	settings := defaultAssistantSettings()
	row := a.DB.QueryRow(`select enabled,coalesce(provider,''),coalesce(base_url,''),api_key_ciphertext,api_key_nonce,coalesce(model,''),coalesce(protocol,''),coalesce(context_tokens,32000),coalesce(temperature,0.2),coalesce(request_timeout,60),coalesce(max_tool_rounds,8),coalesce(execution_mode,'confirm_writes'),coalesce(show_tool_details,true),coalesce(orb_enabled,true) from assistant_settings where id=1`)
	var enabled, showTools, orb bool
	var provider, baseURL, model, protocol, executionMode string
	var cipherText, nonce []byte
	if err := row.Scan(&enabled, &provider, &baseURL, &cipherText, &nonce, &model, &protocol, &settings.ContextTokens, &settings.Temperature, &settings.RequestTimeout, &settings.MaxToolRounds, &executionMode, &showTools, &orb); err != nil {
		if errors.Is(err, os.ErrNotExist) || strings.Contains(err.Error(), "no rows") {
			return settings, nil
		}
		return settings, err
	}
	settings.Enabled = enabled
	settings.Provider = provider
	settings.BaseURL = baseURL
	settings.Model = model
	settings.Protocol = protocol
	settings.ExecutionMode = assistant.ExecutionMode(executionMode)
	settings.ShowToolDetail = showTools
	settings.OrbEnabled = orb
	settings.APIKeySet = len(cipherText) > 0 && len(nonce) > 0
	if settings.APIKeySet {
		apiKey, decryptErr := a.decryptAssistantSecret(cipherText, nonce)
		if decryptErr != nil {
			return settings, fmt.Errorf("decrypt assistant API key: %w", decryptErr)
		}
		settings.APIKey = apiKey
	}
	return settings, nil
}

func (a *App) saveAssistantSettings(patch assistantSettingsPatch) (assistantSettings, error) {
	current, err := a.getAssistantSettings()
	if err != nil {
		return current, err
	}
	if patch.Enabled != nil {
		current.Enabled = *patch.Enabled
	}
	if patch.Provider != nil {
		current.Provider = strings.TrimSpace(*patch.Provider)
	}
	if patch.BaseURL != nil {
		current.BaseURL = strings.TrimRight(strings.TrimSpace(*patch.BaseURL), "/")
	}
	if patch.APIKey != nil && strings.TrimSpace(*patch.APIKey) != "" {
		current.APIKey = strings.TrimSpace(*patch.APIKey)
		current.APIKeySet = true
	}
	if patch.Model != nil {
		current.Model = strings.TrimSpace(*patch.Model)
	}
	if patch.Protocol != nil {
		current.Protocol = strings.TrimSpace(*patch.Protocol)
	}
	if patch.ContextTokens != nil {
		current.ContextTokens = clampAssistantInt(*patch.ContextTokens, 4096, 256000)
	}
	if patch.Temperature != nil {
		current.Temperature = clampFloat(*patch.Temperature, 0, 2)
	}
	if patch.RequestTimeout != nil {
		current.RequestTimeout = clampAssistantInt(*patch.RequestTimeout, 5, 300)
	}
	if patch.MaxToolRounds != nil {
		current.MaxToolRounds = clampAssistantInt(*patch.MaxToolRounds, 1, 16)
	}
	if patch.ExecutionMode != nil {
		current.ExecutionMode = *patch.ExecutionMode
	}
	if patch.ShowToolDetail != nil {
		current.ShowToolDetail = *patch.ShowToolDetail
	}
	if patch.OrbEnabled != nil {
		current.OrbEnabled = *patch.OrbEnabled
	}
	if current.Provider == "" {
		current.Provider = "openai_compatible"
	}
	if current.Protocol == "" {
		current.Protocol = "chat_completions"
	}
	if current.ExecutionMode != assistant.ExecutionReadOnly && current.ExecutionMode != assistant.ExecutionConfirmWrites && current.ExecutionMode != assistant.ExecutionFullAuto {
		return current, fmt.Errorf("invalid assistant execution mode")
	}

	var encrypted, nonce []byte
	if current.APIKeySet {
		encrypted, nonce, err = a.encryptAssistantSecret(current.APIKey)
		if err != nil {
			return current, err
		}
	}
	_, err = a.DB.Exec(`insert into assistant_settings(id,enabled,provider,base_url,api_key_ciphertext,api_key_nonce,model,protocol,context_tokens,temperature,request_timeout,max_tool_rounds,execution_mode,show_tool_details,orb_enabled,updated_at) values(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) on conflict(id) do update set enabled=excluded.enabled,provider=excluded.provider,base_url=excluded.base_url,api_key_ciphertext=excluded.api_key_ciphertext,api_key_nonce=excluded.api_key_nonce,model=excluded.model,protocol=excluded.protocol,context_tokens=excluded.context_tokens,temperature=excluded.temperature,request_timeout=excluded.request_timeout,max_tool_rounds=excluded.max_tool_rounds,execution_mode=excluded.execution_mode,show_tool_details=excluded.show_tool_details,orb_enabled=excluded.orb_enabled,updated_at=excluded.updated_at`, current.Enabled, current.Provider, current.BaseURL, encrypted, nonce, current.Model, current.Protocol, current.ContextTokens, current.Temperature, current.RequestTimeout, current.MaxToolRounds, current.ExecutionMode, current.ShowToolDetail, current.OrbEnabled, time.Now())
	if err != nil {
		return current, err
	}
	return current, nil
}

func clampAssistantInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func clampFloat(value, min, max float64) float64 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func (a *App) assistantKeyPath() string {
	return filepath.Join(a.DataDir, "data", "secrets", "assistant.key")
}

func (a *App) assistantKey() ([]byte, error) {
	path := a.assistantKeyPath()
	if key, err := os.ReadFile(path); err == nil {
		if len(key) != 32 {
			return nil, fmt.Errorf("assistant key has invalid length")
		}
		return key, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if errors.Is(err, os.ErrExist) {
		existing, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil, readErr
		}
		if len(existing) != 32 {
			return nil, fmt.Errorf("assistant key has invalid length")
		}
		return existing, nil
	}
	if err != nil {
		return nil, err
	}
	if _, err := file.Write(key); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return nil, err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return nil, err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	return key, nil
}

func (a *App) encryptAssistantSecret(value string) ([]byte, []byte, error) {
	key, err := a.assistantKey()
	if err != nil {
		return nil, nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	return gcm.Seal(nil, nonce, []byte(value), nil), nonce, nil
}

func (a *App) decryptAssistantSecret(cipherText, nonce []byte) (string, error) {
	key, err := a.assistantKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plain, err := gcm.Open(nil, nonce, cipherText, nil)
	return string(plain), err
}

func assistantSettingsResponse(settings assistantSettings) map[string]any {
	return map[string]any{
		"enabled":           settings.Enabled,
		"provider":          settings.Provider,
		"base_url":          settings.BaseURL,
		"api_key_set":       settings.APIKeySet,
		"model":             settings.Model,
		"protocol":          settings.Protocol,
		"context_tokens":    settings.ContextTokens,
		"temperature":       settings.Temperature,
		"request_timeout":   settings.RequestTimeout,
		"max_tool_rounds":   settings.MaxToolRounds,
		"show_tool_details": settings.ShowToolDetail,
		"orb_enabled":       settings.OrbEnabled,
	}
}
