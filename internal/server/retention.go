package server

import (
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Retention limits for unbounded-growth tables and update artifacts.  Every
// config history row carries a full config snapshot (~tens of KB), so
// unpruned histories grow without bound; audit logs are smaller but also
// never expired on their own.  Starred (is_stable) histories are always kept.
const (
	retentionHistoryKeep        = 500
	retentionHistoryDeletedDays = 30
	retentionAuditKeep          = 20000
	retentionAuditDays          = 90
	retentionUpdatesKeep        = 2
	retentionInterval           = 24 * time.Hour
)

// applyRetentionPolicies prunes history/audit tables and stale update
// artifacts.  Failures are logged, never fatal: retention must not block
// startup.
func (a *App) applyRetentionPolicies() {
	a.pruneConfigHistories()
	a.pruneAuditLogs()
	a.pruneUpdateArtifacts()
}

func (a *App) pruneConfigHistories() {
	deletedBefore := time.Now().AddDate(0, 0, -retentionHistoryDeletedDays)
	if _, err := a.DB.Exec(`delete from config_histories where deleted_at is not null and deleted_at < ?`, deletedBefore); err != nil {
		log.Printf("prune deleted config_histories: %v", err)
	}
	if _, err := a.DB.Exec(`delete from config_histories where deleted_at is null and coalesce(is_stable,0)=0 and id not in (
		select id from config_histories where deleted_at is null and coalesce(is_stable,0)=0 order by id desc limit ?
	)`, retentionHistoryKeep); err != nil {
		log.Printf("prune config_histories by count: %v", err)
	}
}

func (a *App) pruneAuditLogs() {
	createdBefore := time.Now().AddDate(0, 0, -retentionAuditDays)
	if _, err := a.DB.Exec(`delete from audit_logs where created_at < ?`, createdBefore); err != nil {
		log.Printf("prune audit_logs by age: %v", err)
	}
	if _, err := a.DB.Exec(`delete from audit_logs where id not in (
		select id from audit_logs order by id desc limit ?
	)`, retentionAuditKeep); err != nil {
		log.Printf("prune audit_logs by count: %v", err)
	}
}

// pruneUpdateArtifacts keeps only the newest install-* staging directories
// and the newest downloaded archives under data/updates.  Each failed or
// superseded install leaves a full extracted copy (~100MB) behind otherwise.
func (a *App) pruneUpdateArtifacts() {
	updatesDir := filepath.Join(a.DataDir, "data", "updates")
	entries, err := os.ReadDir(updatesDir)
	if err != nil {
		return
	}
	pruneNamed := func(names []string, isDir bool) {
		if len(names) <= retentionUpdatesKeep {
			return
		}
		sort.Strings(names) // names are timestamp-prefixed; newest sorts last
		for _, name := range names[:len(names)-retentionUpdatesKeep] {
			target := filepath.Join(updatesDir, name)
			var removeErr error
			if isDir {
				removeErr = os.RemoveAll(target)
			} else {
				removeErr = os.Remove(target)
			}
			if removeErr != nil {
				log.Printf("prune update artifact %s: %v", target, removeErr)
			}
		}
	}
	var installDirs, archives []string
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, "install-") && entry.IsDir() {
			installDirs = append(installDirs, name)
			continue
		}
		if entry.IsDir() {
			continue
		}
		switch filepath.Ext(name) {
		case ".gz", ".zip", ".tgz", ".xz", ".bz2":
			archives = append(archives, name)
		}
	}
	pruneNamed(installDirs, true)
	pruneNamed(archives, false)
}

// startRetentionLoop applies retention once at startup and then daily.
func (a *App) startRetentionLoop() {
	go func() {
		a.applyRetentionPolicies()
		ticker := time.NewTicker(retentionInterval)
		defer ticker.Stop()
		for range ticker.C {
			a.applyRetentionPolicies()
		}
	}()
}
