package server

import (
	"crypto/subtle"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
)

const localMenuBarTokenHashKey = "macos.menubar.token_hash"

// IssueLocalMenuBarToken rotates the credential used by the local menu bar app.
// Only the hash is persisted; the raw token is returned once to the privileged installer.
func (a *App) IssueLocalMenuBarToken() (string, error) {
	token := "msf_local_" + randomHex(32)
	hash := tokenHash(token)
	if _, err := a.DB.Exec(
		`insert or replace into settings(key,value,updated_at) values(?,?,?)`,
		localMenuBarTokenHashKey,
		hash,
		time.Now(),
	); err != nil {
		return "", err
	}
	if stored := a.setting(localMenuBarTokenHashKey, ""); stored != hash {
		return "", errors.New("local menu bar token was not persisted")
	}
	return token, nil
}

func (a *App) authenticateLocalMenuBarToken(token, remoteAddr string) (*AuthIdentity, error) {
	if !loopbackRemoteAddress(remoteAddr) {
		return nil, errors.New("local menu bar token requires a loopback connection")
	}
	expectedHash := strings.TrimSpace(a.setting(localMenuBarTokenHashKey, ""))
	providedHash := tokenHash(token)
	if expectedHash == "" || subtle.ConstantTimeCompare([]byte(expectedHash), []byte(providedHash)) != 1 {
		return nil, errors.New("invalid local menu bar token")
	}
	user := &User{
		Username:    "msf-menubar",
		DisplayName: "MSF Menu Bar",
		Role:        "operator",
		IsActive:    true,
	}
	return &AuthIdentity{
		User:       user,
		AuthType:   "local_menubar",
		TokenScope: "operate",
	}, nil
}

func loopbackRemoteAddress(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(remoteAddr))
	if err != nil {
		host = strings.Trim(strings.TrimSpace(remoteAddr), "[]")
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func localMenuBarAllows(method, path string) bool {
	if method == http.MethodGet && path == "/api/v1/network/runtime" {
		return true
	}
	if method != http.MethodPost {
		return false
	}
	switch path {
	case "/api/v1/network/runtime/enable",
		"/api/v1/network/runtime/disable",
		"/api/v1/network/runtime/restart",
		"/api/v1/network/runtime/stop":
		return true
	default:
		return false
	}
}
