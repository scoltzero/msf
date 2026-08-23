package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func fakeIPPrefixChanged(oldCfg, newCfg SetupConfig) bool {
	return fakeIPv4RouteCIDR(oldCfg.FakeIPRangeV4) != fakeIPv4RouteCIDR(newCfg.FakeIPRangeV4) ||
		fakeIPv6RouteCIDR(oldCfg.FakeIPRangeV6) != fakeIPv6RouteCIDR(newCfg.FakeIPRangeV6)
}

type fakeIPCacheMove struct {
	Original string
	Backup   string
}

type fakeIPCacheInvalidation struct {
	Root              string
	Moves             []fakeIPCacheMove
	OriginallyRunning map[string]bool
	MosDNSMethod      string
	MihomoMethod      string
}

var mihomoFakeIPControllerCall = func(a *App, method, path string) error {
	_, ok, err := a.mihomoControllerJSON(method, path, nil)
	if ok {
		return nil
	}
	if err == nil {
		return errors.New("Mihomo FakeIP cache endpoint unavailable")
	}
	return err
}

func (a *App) beginFakeIPCacheInvalidation(ctx context.Context) (*fakeIPCacheInvalidation, error) {
	tx := &fakeIPCacheInvalidation{OriginallyRunning: map[string]bool{}}
	if err := a.flushOrRebuildMosDNSCache(ctx, tx); err != nil {
		return tx, fmt.Errorf("flush MosDNS FakeIP cache: %w", err)
	}
	if err := a.flushOrRebuildMihomoCache(ctx, tx); err != nil {
		return tx, fmt.Errorf("flush Mihomo FakeIP cache: %w", err)
	}
	return tx, nil
}

func (a *App) flushOrRebuildMosDNSCache(ctx context.Context, tx *fakeIPCacheInvalidation) error {
	if !a.Services.Status("mosdns").Running {
		return nil
	}
	var lastErr error
	for _, path := range []string{"/cache/flush", "/api/cache/flush", "/plugins/cache/flush"} {
		if err := httpPostNoBody(a.mosDNSAPIURL(path)); err == nil {
			tx.MosDNSMethod = "controller:" + path
			return nil
		} else {
			lastErr = err
		}
	}
	if err := a.rebuildServiceFakeIPCache(ctx, tx, "mosdns", a.mosDNSCacheCandidates()); err != nil {
		return errors.Join(lastErr, err)
	}
	tx.MosDNSMethod = "service-rebuild"
	return nil
}

func (a *App) flushOrRebuildMihomoCache(ctx context.Context, tx *fakeIPCacheInvalidation) error {
	if !a.Services.Status("mihomo").Running {
		return nil
	}
	var lastErr error
	unsupported := true
	for _, endpoint := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/cache/fakeip/flush"},
		{method: http.MethodDelete, path: "/cache/fakeip"},
	} {
		err := mihomoFakeIPControllerCall(a, endpoint.method, endpoint.path)
		if err == nil {
			tx.MihomoMethod = endpoint.method + " " + endpoint.path
			return nil
		}
		lastErr = err
		status := controllerErrorStatus(err)
		if status == http.StatusUnauthorized || status == http.StatusForbidden {
			return err
		}
		if status != http.StatusNotFound && status != http.StatusMethodNotAllowed {
			unsupported = false
		}
	}
	if err := a.rebuildServiceFakeIPCache(ctx, tx, "mihomo", a.mihomoCacheCandidates()); err != nil {
		if unsupported {
			return fmt.Errorf("controller endpoints unsupported; fallback failed: %w", err)
		}
		return errors.Join(lastErr, err)
	}
	tx.MihomoMethod = "service-rebuild"
	return nil
}

func controllerErrorStatus(err error) int {
	if err == nil {
		return 0
	}
	text := strings.ToLower(err.Error())
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusMethodNotAllowed} {
		if strings.Contains(text, fmt.Sprintf("http %d", status)) {
			return status
		}
	}
	return 0
}

func (a *App) rebuildServiceFakeIPCache(ctx context.Context, tx *fakeIPCacheInvalidation, service string, candidates []string) error {
	running := a.Services.Status(service).Running
	tx.OriginallyRunning[service] = running
	if running {
		if _, err := a.Services.stop(ctx, service, false); err != nil {
			return err
		}
	}
	if err := a.quarantineFakeIPCacheFiles(tx, candidates); err != nil {
		if running {
			_, _ = a.Services.Start(ctx, service)
		}
		return err
	}
	if running {
		if _, err := a.Services.Start(ctx, service); err != nil {
			_ = tx.restoreServiceFiles(service, a)
			_, _ = a.Services.Start(ctx, service)
			return err
		}
	}
	return nil
}

func (a *App) quarantineFakeIPCacheFiles(tx *fakeIPCacheInvalidation, candidates []string) error {
	for _, path := range candidates {
		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if info.IsDir() {
			continue
		}
		if tx.Root == "" {
			tx.Root = filepath.Join(a.DataDir, "backups", "fakeip-cache", time.Now().UTC().Format("20060102T150405.000000000Z"))
		}
		rel, err := filepath.Rel(a.DataDir, path)
		if err != nil || strings.HasPrefix(rel, "..") {
			return fmt.Errorf("cache path is outside data dir: %s", path)
		}
		backup := filepath.Join(tx.Root, rel)
		if err := os.MkdirAll(filepath.Dir(backup), 0755); err != nil {
			return err
		}
		if err := os.Rename(path, backup); err != nil {
			return err
		}
		tx.Moves = append(tx.Moves, fakeIPCacheMove{Original: path, Backup: backup})
	}
	return nil
}

func (a *App) mihomoCacheCandidates() []string {
	return []string{
		filepath.Join(a.DataDir, "configs", "mihomo", "cache.db"),
		filepath.Join(a.DataDir, "configs", "mihomo", ".cache", "cache.db"),
		filepath.Join(a.DataDir, "configs", "mihomo", "fakeip.cache"),
	}
}

func (a *App) mosDNSCacheCandidates() []string {
	cacheDir := filepath.Join(a.DataDir, "configs", "mosdns", "cache")
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		return nil
	}
	var paths []string
	for _, entry := range entries {
		name := strings.ToLower(entry.Name())
		if entry.IsDir() || (!strings.Contains(name, "cache") && !strings.Contains(name, "dump")) {
			continue
		}
		paths = append(paths, filepath.Join(cacheDir, entry.Name()))
	}
	return paths
}

func (tx *fakeIPCacheInvalidation) commit() error {
	if tx == nil || tx.Root == "" {
		return nil
	}
	return os.RemoveAll(tx.Root)
}

func (tx *fakeIPCacheInvalidation) rollback(ctx context.Context, a *App) error {
	if tx == nil {
		return nil
	}
	var errs []error
	for _, service := range []string{"mosdns", "mihomo"} {
		if !tx.OriginallyRunning[service] {
			continue
		}
		if a.Services.Status(service).Running {
			if _, err := a.Services.stop(ctx, service, false); err != nil {
				errs = append(errs, err)
			}
		}
		if err := tx.restoreServiceFiles(service, a); err != nil {
			errs = append(errs, err)
		}
		if _, err := a.Services.Start(ctx, service); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (tx *fakeIPCacheInvalidation) restoreServiceFiles(service string, a *App) error {
	marker := string(filepath.Separator) + service + string(filepath.Separator)
	var errs []error
	for i := len(tx.Moves) - 1; i >= 0; i-- {
		move := tx.Moves[i]
		if !strings.Contains(move.Original, marker) {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(move.Original), 0755); err != nil {
			errs = append(errs, err)
			continue
		}
		if err := os.Remove(move.Original); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err)
			continue
		}
		if err := os.Rename(move.Backup, move.Original); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
