package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const factoryResetRequestMarkerName = ".factory-reset-request.json"

type pendingFactoryResetRequest struct {
	SchemaVersion    int        `json:"schema_version"`
	ResetID          string     `json:"reset_id"`
	Phase            resetPhase `json:"phase"`
	DeleteComponents bool       `json:"delete_components"`
	RequestedAt      time.Time  `json:"requested_at"`
	Attempt          int        `json:"attempt"`
	LastError        string     `json:"last_error,omitempty"`
}

func newFactoryResetRequest(deleteComponents bool) pendingFactoryResetRequest {
	return pendingFactoryResetRequest{
		SchemaVersion:    1,
		ResetID:          fmt.Sprintf("fr-%d-%s", time.Now().UnixNano(), randomHex(4)),
		Phase:            resetPhaseRequested,
		DeleteComponents: deleteComponents,
		RequestedAt:      time.Now(),
	}
}

func factoryResetRequestPath(dataDir string) string {
	return filepath.Join(dataDir, factoryResetRequestMarkerName)
}

func readFactoryResetRequest(dataDir string) (pendingFactoryResetRequest, bool, error) {
	body, err := os.ReadFile(factoryResetRequestPath(dataDir))
	if errors.Is(err, os.ErrNotExist) {
		return pendingFactoryResetRequest{}, false, nil
	}
	if err != nil {
		return pendingFactoryResetRequest{}, false, err
	}
	var request pendingFactoryResetRequest
	if err := json.Unmarshal(body, &request); err != nil {
		return pendingFactoryResetRequest{}, true, fmt.Errorf("decode factory reset request: %w", err)
	}
	if request.SchemaVersion != 1 || request.ResetID == "" || request.RequestedAt.IsZero() {
		return pendingFactoryResetRequest{}, true, errors.New("invalid factory reset request marker")
	}
	return request, true, nil
}

func writeFactoryResetRequest(dataDir string, request pendingFactoryResetRequest) error {
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	path := factoryResetRequestPath(dataDir)
	tmp, err := os.CreateTemp(dataDir, ".factory-reset-request.tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(body); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	cleanup = false
	if dir, err := os.Open(dataDir); err == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	return nil
}

func removeFactoryResetRequest(dataDir string) error {
	err := os.Remove(factoryResetRequestPath(dataDir))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func FactoryResetRequestPending(dataDir string) (bool, error) {
	_, ok, err := readFactoryResetRequest(dataDir)
	return ok, err
}

func (a *App) CompletePendingFactoryReset(ctx context.Context) (bool, error) {
	request, ok, err := readFactoryResetRequest(a.DataDir)
	if err != nil || !ok {
		return false, err
	}
	if request.Phase == resetPhaseFailed && request.Attempt >= 3 {
		a.operations.mu.Lock()
		a.operations.resetID = request.ResetID
		a.operations.phase = resetPhaseFailed
		a.operations.mu.Unlock()
		return true, nil
	}
	request.Attempt++
	request.Phase = resetPhaseRunning
	request.LastError = ""
	if err := writeFactoryResetRequest(a.DataDir, request); err != nil {
		return true, err
	}
	stopCtx, stopCancel := context.WithTimeout(ctx, 2*time.Second)
	if err := a.stopDetachedSelfUpdate(stopCtx); err != nil {
		stopCancel()
		request.Phase = resetPhaseFailed
		request.LastError = err.Error()
		_ = writeFactoryResetRequest(a.DataDir, request)
		return true, fmt.Errorf("stop detached self update: %w", err)
	}
	stopCancel()
	a.operations.mu.Lock()
	a.operations.resetID = request.ResetID
	a.operations.mu.Unlock()
	a.operations.setPhase(resetPhaseRunning)
	_, err = a.factoryReset(ctx, factoryResetOptions{DeleteComponents: request.DeleteComponents})
	if err != nil {
		request.Phase = resetPhaseFailed
		request.LastError = err.Error()
		_ = writeFactoryResetRequest(a.DataDir, request)
		a.operations.setPhase(resetPhaseFailed)
		return true, err
	}
	if err := removeFactoryResetRequest(a.DataDir); err != nil {
		return true, err
	}
	a.operations = newOperationController()
	return true, nil
}
