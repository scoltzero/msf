package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const selfUpdateTaskMarkerName = ".self-update-task.json"

type selfUpdateTask struct {
	Kind      string    `json:"kind"`
	Unit      string    `json:"unit,omitempty"`
	PID       int       `json:"pid,omitempty"`
	StartedAt time.Time `json:"started_at"`
}

func (a *App) writeSelfUpdateTask(task selfUpdateTask) error {
	body, err := json.Marshal(task)
	if err != nil {
		return err
	}
	path := filepath.Join(a.DataDir, selfUpdateTaskMarkerName)
	tmp, err := os.CreateTemp(a.DataDir, ".self-update-task.tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
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
	return os.Rename(tmpPath, path)
}

func (a *App) clearSelfUpdateTask() {
	_ = os.Remove(filepath.Join(a.DataDir, selfUpdateTaskMarkerName))
}

func (a *App) stopDetachedSelfUpdate(ctx context.Context) error {
	path := filepath.Join(a.DataDir, selfUpdateTaskMarkerName)
	body, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var task selfUpdateTask
	if err := json.Unmarshal(body, &task); err != nil {
		return fmt.Errorf("decode self update task: %w", err)
	}
	switch task.Kind {
	case "systemd":
		if !strings.HasPrefix(task.Unit, "msf-self-update-") || strings.ContainsAny(task.Unit, "/ \\") {
			return fmt.Errorf("refuse unsafe self update unit %q", task.Unit)
		}
		_, _ = combinedOutputWithTimeout(ctx, time.Second, "systemctl", "stop", task.Unit)
		_, _ = combinedOutputWithTimeout(ctx, time.Second, "systemctl", "kill", "--kill-who=all", "--signal=KILL", task.Unit)
	case "process":
		if task.PID <= 1 || task.PID == os.Getpid() {
			return fmt.Errorf("refuse unsafe self update pid %d", task.PID)
		}
		_ = syscall.Kill(-task.PID, syscall.SIGTERM)
		deadline := time.Now().Add(time.Second)
		for time.Now().Before(deadline) && processAliveCross(task.PID) {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(50 * time.Millisecond):
			}
		}
		if processAliveCross(task.PID) {
			_ = syscall.Kill(-task.PID, syscall.SIGKILL)
		}
	default:
		return fmt.Errorf("unknown self update task kind %q", task.Kind)
	}
	a.clearSelfUpdateTask()
	return nil
}

func processGroupCommand(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
	return cmd
}
