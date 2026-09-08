package server

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Managed child services inherit the *os.File handles opened with O_APPEND in
// process.go, so a rename-based rotation would silently keep writing to the
// renamed inode.  Instead rotation copies the current file to the head of the
// backup chain and truncates the original in place: with O_APPEND every
// subsequent write still lands at the new end of the file.  This is the
// copytruncate strategy, done in-process so it also works on hosts without
// logrotate (Docker, fnOS).
const (
	logRotateInterval = time.Hour
)

// Rotation budgets are tiered by free space on the log filesystem so small
// disks (fnOS NAS shares, small Docker volumes) can't be written through by
// logs, while roomy hosts keep comfortable history for post-mortems.
const (
	logTierSpaciousFree    = 10 << 30 // ≥10GB free: full history
	logTierSpaciousSize    = 50 << 20
	logTierSpaciousBackups = 3

	logTierTightFree    = 2 << 30 // 2–10GB free: trimmed history
	logTierTightSize    = 20 << 20
	logTierTightBackups = 2

	logTierLowSize    = 5 << 20 // <2GB free: keep barely enough to debug
	logTierLowBackups = 1
)

// logRotationTier returns the size threshold and backup count for the current
// free space on the filesystem hosting a.DataDir/logs.
func (a *App) logRotationTier() (threshold int64, backups int) {
	free, ok := freeBytesForDir(filepath.Join(a.DataDir, "logs"))
	if ok && free >= logTierSpaciousFree {
		return logTierSpaciousSize, logTierSpaciousBackups
	}
	if ok && free >= logTierTightFree {
		return logTierTightSize, logTierTightBackups
	}
	return logTierLowSize, logTierLowBackups
}

func (a *App) managedLogPaths() []string {
	return []string{
		filepath.Join(a.DataDir, "logs", "mihomo.out.log"),
		filepath.Join(a.DataDir, "logs", "mihomo.err.log"),
		filepath.Join(a.DataDir, "logs", "mosdns.out.log"),
		filepath.Join(a.DataDir, "logs", "mosdns.err.log"),
		filepath.Join(a.DataDir, "logs", "msf.log"),
		filepath.Join(a.DataDir, "logs", "supervisor", "supervisord.log"),
	}
}

// rotateLogsIfLarge rotates every managed log that exceeds the tier threshold.
// Failures are logged and skipped: rotation must never take the panel down.
func (a *App) rotateLogsIfLarge() {
	threshold, backups := a.logRotationTier()
	for _, path := range a.managedLogPaths() {
		if err := rotateLogIfLarge(path, threshold, backups); err != nil {
			log.Printf("log rotation skipped for %s: %v", path, err)
		}
	}
}

func rotateLogIfLarge(path string, threshold int64, backups int) error {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.Size() < threshold {
		return nil
	}
	// Shift the backup chain: drop the oldest, .N-1 -> .N, ..., current -> .1.
	oldest := logBackupPath(path, backups)
	if _, err := os.Stat(oldest); err == nil {
		if err := os.Remove(oldest); err != nil {
			return err
		}
	}
	for i := backups; i > 1; i-- {
		older := logBackupPath(path, i-1)
		if _, err := os.Stat(older); err != nil {
			continue
		}
		if err := os.Rename(older, logBackupPath(path, i)); err != nil {
			return err
		}
	}
	if err := copyFileForRotation(path, logBackupPath(path, 1)); err != nil {
		return err
	}
	return os.Truncate(path, 0)
}

func logBackupPath(path string, index int) string {
	return filepath.Join(filepath.Dir(path), filepath.Base(path)+"."+strconv.Itoa(index))
}

func copyFileForRotation(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	tmp := dst + ".rotating"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	// Preserve the source timestamp so backup ordering by mtime stays sane.
	if err := os.Chtimes(tmp, info.ModTime(), info.ModTime()); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

// startLogRotationLoop runs the hourly size check for the lifetime of the
// process; an immediate first pass catches growth from a previous run.
func (a *App) startLogRotationLoop() {
	go func() {
		a.rotateLogsIfLarge()
		ticker := time.NewTicker(logRotateInterval)
		defer ticker.Stop()
		for range ticker.C {
			a.rotateLogsIfLarge()
		}
	}()
}

// StartMaintenanceTasks launches the background maintenance loops (log
// rotation, retention pruning).  Call once from the long-running serve entry
// after the base layout is ready; short-lived commands never start them.
func (a *App) StartMaintenanceTasks() {
	a.startLogRotationLoop()
	a.startRetentionLoop()
}
