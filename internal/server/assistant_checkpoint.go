package server

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

const (
	assistantRuntimeName     = "eino"
	assistantRuntimeVersion  = "v0.9.15"
	assistantCheckpointLimit = 8 << 20
	assistantCheckpointTTL   = 24 * time.Hour
)

// assistantCheckpointStore is scoped to one authenticated user and one
// assistant session. Eino only sees opaque bytes; ownership and lifecycle
// remain enforced by MSF's SQLite control plane.
type assistantCheckpointStore struct {
	db        *sql.DB
	userID    int64
	sessionID string
}

func (a *App) assistantCheckpointStore(userID int64, sessionID string) *assistantCheckpointStore {
	return &assistantCheckpointStore{db: a.DB, userID: userID, sessionID: sessionID}
}

func (s *assistantCheckpointStore) Get(ctx context.Context, checkpointID string) ([]byte, bool, error) {
	var payload []byte
	var runtime, version, status string
	var expiresAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `select payload,runtime,runtime_version,status,expires_at from assistant_runtime_checkpoints where id=? and user_id=? and session_id=?`, checkpointID, s.userID, s.sessionID).Scan(&payload, &runtime, &version, &status, &expiresAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, false, nil
		}
		return nil, false, err
	}
	if runtime != assistantRuntimeName || version != assistantRuntimeVersion {
		return nil, false, fmt.Errorf("assistant checkpoint runtime mismatch: %s %s", runtime, version)
	}
	if status != "active" || expiresAt.Valid && time.Now().After(expiresAt.Time) {
		return nil, false, nil
	}
	if len(payload) > assistantCheckpointLimit {
		return nil, false, fmt.Errorf("assistant checkpoint exceeds %d bytes", assistantCheckpointLimit)
	}
	return append([]byte(nil), payload...), true, nil
}

func (s *assistantCheckpointStore) Set(ctx context.Context, checkpointID string, payload []byte) error {
	if checkpointID == "" {
		return fmt.Errorf("assistant checkpoint id is required")
	}
	if len(payload) == 0 || len(payload) > assistantCheckpointLimit {
		return fmt.Errorf("assistant checkpoint size %d is outside the allowed range", len(payload))
	}
	now := time.Now()
	_, err := s.db.ExecContext(ctx, `insert into assistant_runtime_checkpoints(id,user_id,session_id,runtime,runtime_version,payload,status,expires_at,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?) on conflict(id) do update set payload=excluded.payload,status='active',expires_at=excluded.expires_at,updated_at=excluded.updated_at where assistant_runtime_checkpoints.user_id=excluded.user_id and assistant_runtime_checkpoints.session_id=excluded.session_id and assistant_runtime_checkpoints.runtime=excluded.runtime and assistant_runtime_checkpoints.runtime_version=excluded.runtime_version`, checkpointID, s.userID, s.sessionID, assistantRuntimeName, assistantRuntimeVersion, payload, "active", now.Add(assistantCheckpointTTL), now, now)
	return err
}

func (s *assistantCheckpointStore) Delete(ctx context.Context, checkpointID string) error {
	_, err := s.db.ExecContext(ctx, `delete from assistant_runtime_checkpoints where id=? and user_id=? and session_id=?`, checkpointID, s.userID, s.sessionID)
	return err
}

func (a *App) cleanupAssistantRuntimeState() {
	now := time.Now()
	_, _ = a.DB.Exec(`delete from assistant_runtime_checkpoints where expires_at is not null and expires_at<?`, now)
	_, _ = a.DB.Exec(`update assistant_pending_actions set status='expired',decision='expired',decided_at=?,call_json='[cleared]',call_hash='' where status='pending' and expires_at<?`, now, now)
	_, _ = a.DB.Exec(`delete from assistant_runtime_checkpoints where id in (select checkpoint_id from assistant_pending_actions where status='expired' and checkpoint_id is not null)`)
	_, _ = a.DB.Exec(`update assistant_sessions set status='error',active_run_id=null,updated_at=? where status='running'`, now)
	_, _ = a.DB.Exec(`update assistant_sessions set status='error',checkpoint_id=null,active_run_id=null,updated_at=? where status='awaiting_approval' and (checkpoint_id is null or not exists(select 1 from assistant_runtime_checkpoints c where c.id=assistant_sessions.checkpoint_id and c.user_id=assistant_sessions.user_id and c.session_id=assistant_sessions.id and c.status='active'))`, now)
}
