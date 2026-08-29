package server

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID          int64      `json:"id"`
	Username    string     `json:"username"`
	Email       string     `json:"email,omitempty"`
	DisplayName string     `json:"display_name,omitempty"`
	Role        string     `json:"role"`
	IsActive    bool       `json:"is_active"`
	LastLogin   *time.Time `json:"last_login,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func (a *App) migrate() error {
	stmts := []string{
		`pragma journal_mode = wal`,
		`create table if not exists settings (key text primary key, value text not null, updated_at datetime)`,
		`create table if not exists users (
			id integer primary key autoincrement,
			username text not null unique,
			password text not null,
			email text,
			display_name text,
			role text default 'operator',
			is_active numeric default true,
			last_login datetime,
			failed_attempts integer default 0,
			locked_until datetime,
			created_at datetime,
			updated_at datetime,
			deleted_at datetime
		)`,
		`create table if not exists refresh_tokens (
			id integer primary key autoincrement,
			user_id integer not null,
			token_hash text not null,
			expires_at datetime,
			revoked numeric default false,
			created_at datetime
		)`,
		`create table if not exists api_tokens (
			id integer primary key autoincrement,
			user_id integer not null,
			name text not null,
			token_hash text not null,
			scope text not null default 'admin',
			last_used_at datetime,
			expires_at datetime,
			created_at datetime,
			revoked numeric default false
		)`,
		`create table if not exists audit_logs (
			id integer primary key autoincrement,
			user_id integer,
			username text,
			action text,
			target text,
			detail text,
			success numeric,
			error text,
			ip_address text,
			created_at datetime
		)`,
		`create table if not exists system_setups (
			id integer primary key autoincrement,
			created_at datetime,
			updated_at datetime,
			username text not null,
			email text,
			timezone text default 'Asia/Shanghai',
			web_port text default '7777',
			amd64v3_enabled numeric default false,
			selected_interface text,
			singbox_core_type text default '',
			mihomo_core_type text default 'meta',
			auto_set_dns numeric default true,
			dns_on text default '127.0.0.1',
			dns_off text default '223.5.5.5',
			enable_ipv6 numeric default true,
			fake_ip_range_v4 text default '28.0.0.0/8',
			fake_ip_range_v6 text default 'f2b0::/18',
			linux_proxy_mode text default 'nft',
			nft_proxy_policy text default 'direct_default',
			proxy_core text default 'mihomo',
			mos_dns_enabled numeric default true,
			subscription_urls text,
			mihomo_proxies text,
			github_proxy_enabled numeric default false,
			github_https_proxy text,
			github_http_proxy text,
			github_socks5_proxy text,
			github_accelerator_enabled numeric default false,
			github_accelerator_url text,
			is_initialized numeric default false
		)`,
		`create table if not exists config_histories (
			id integer primary key autoincrement,
			service text not null,
			file_path text not null,
			content text,
			comment text,
			is_stable numeric default false,
			created_by text default 'admin',
			created_at datetime,
			updated_at datetime,
			deleted_at datetime
		)`,
		`create table if not exists mosdns_clients (
			id integer primary key autoincrement,
			mac text,
			ip text not null,
			hostname text,
			vendor text,
			custom_name text,
			custom_desc text,
			source text,
			type text,
			query_count integer default 0,
			first_seen_at datetime,
			last_seen_at datetime,
			last_scan_at datetime,
			interface text,
			is_online numeric default false,
			created_at datetime,
			updated_at datetime
		)`,
		`create unique index if not exists idx_mac_ip on mosdns_clients(mac, ip)`,
		`create table if not exists mosdns_client_ips (
			id integer primary key autoincrement,
			ip text not null unique,
			comment text,
			created_at datetime,
			updated_at datetime
		)`,
		`create table if not exists mosdns_switch_states (
			id integer primary key autoincrement,
			switch_key text not null unique,
			enabled numeric,
			created_at datetime,
			updated_at datetime
		)`,
		`create table if not exists update_info (
			id integer primary key autoincrement,
			component text default 'msf',
			current_version text,
			latest_version text,
			has_update numeric default false,
			status text default 'idle',
			phase text default 'idle',
			progress integer default 0,
			message text,
			event_log text,
			error_message text,
			download_url text,
			release_notes text,
			last_check_time datetime,
			created_at datetime,
			updated_at datetime
		)`,
		`create table if not exists component_update_info (
			id integer primary key autoincrement,
			component text not null unique,
			current_version text,
			latest_version text,
			has_update numeric default false,
			download_url text,
			download_digest text,
			verified_digest text,
			verified numeric default false,
			verification_source text,
			installed_verified_digest text,
			installed_verification_source text,
			installed_verified_at datetime,
			release_body text,
			status text default 'idle',
			progress integer default 0,
			error_message text,
			last_check_time datetime,
			created_at datetime,
			updated_at datetime
		)`,
		`create table if not exists component_update_config (
			id integer primary key autoincrement,
			component text not null unique,
			auto_check numeric default true,
			check_interval integer default 86400,
			auto_update numeric default false,
			created_at datetime,
			updated_at datetime
		)`,
		`create table if not exists assistant_settings (
			id integer primary key check (id=1),
			enabled numeric default false,
			provider text default 'openai_compatible',
			base_url text default '',
			api_key_ciphertext blob,
			api_key_nonce blob,
			model text default '',
			protocol text default 'chat_completions',
			context_tokens integer default 32000,
			temperature real default 0.2,
			request_timeout integer default 60,
			max_tool_rounds integer default 8,
			execution_mode text default 'confirm_writes',
			show_tool_details numeric default true,
			orb_enabled numeric default true,
			updated_at datetime
		)`,
		`create table if not exists assistant_sessions (
			id text primary key,
			user_id integer not null,
			title text,
			status text default 'idle',
			messages_json text not null default '[]',
			runtime text default 'eino',
			runtime_version text default 'v0.9.15',
			execution_mode text default 'confirm_writes',
			checkpoint_id text,
			active_run_id text,
			created_at datetime,
			updated_at datetime
		)`,
		`create index if not exists idx_assistant_sessions_user_updated on assistant_sessions(user_id, updated_at desc)`,
		`create table if not exists assistant_pending_actions (
			id text primary key,
			user_id integer not null,
			session_id text not null,
			capability text not null,
			call_json text not null,
			call_hash text not null,
			risk text not null,
			checkpoint_id text,
			interrupt_id text,
			tool_call_id text,
			tool_name text,
			execution_mode text default 'confirm_writes',
			decision text,
			decided_at datetime,
			status text default 'pending',
			expires_at datetime not null,
			created_at datetime
		)`,
		`create index if not exists idx_assistant_pending_user_status on assistant_pending_actions(user_id, status)`,
		`create table if not exists assistant_runtime_checkpoints (
			id text primary key,
			user_id integer not null,
			session_id text not null,
			runtime text not null default 'eino',
			runtime_version text not null default 'v0.9.15',
			payload blob not null,
			status text not null default 'active',
			expires_at datetime,
			created_at datetime,
			updated_at datetime
		)`,
		`create index if not exists idx_assistant_checkpoints_session on assistant_runtime_checkpoints(user_id, session_id, status)`,
		`create table if not exists assistant_skills (
			id text primary key,
			user_id integer not null,
			name text not null,
			description text not null default '',
			prompt text not null,
			source text not null default 'custom',
			file_path text not null,
			created_at datetime,
			updated_at datetime,
			deleted_at datetime
		)`,
		`create index if not exists idx_assistant_skills_user_updated on assistant_skills(user_id, deleted_at, updated_at desc)`,
		`create table if not exists assistant_tool_runs (
			id text primary key,
			user_id integer not null,
			session_id text not null,
			capability text not null,
			method text not null,
			path text not null,
			risk text not null,
			exposure text not null,
			confirmed numeric default false,
			status text not null,
			arguments_summary text,
			result_summary text,
			error_code text,
			duration_ms integer default 0,
			created_at datetime
		)`,
	}
	for _, stmt := range stmts {
		if _, err := a.DB.Exec(stmt); err != nil {
			return fmt.Errorf("migrate %q: %w", stmt, err)
		}
	}
	if err := a.ensureAPITokenScopeColumn(); err != nil {
		return err
	}
	if err := a.ensureUpdateInfoStateColumns(); err != nil {
		return err
	}
	if err := a.ensureComponentUpdateInfoComplianceColumns(); err != nil {
		return err
	}
	if err := a.ensureSystemSetupsTimezoneColumn(); err != nil {
		return err
	}
	if err := a.ensureSystemSetupsMihomoCoreTypeColumn(); err != nil {
		return err
	}
	if err := a.ensureAssistantRuntimeColumns(); err != nil {
		return err
	}
	if err := a.normalizePersistedRows(); err != nil {
		return err
	}
	if err := a.repairAssistantSessionTitles(); err != nil {
		return err
	}
	return nil
}

func (a *App) ensureAssistantRuntimeColumns() error {
	if err := a.ensureTableColumns("assistant_sessions", map[string]string{
		"runtime":         "text default 'eino'",
		"runtime_version": "text default 'v0.9.15'",
		"execution_mode":  "text default 'confirm_writes'",
		"checkpoint_id":   "text",
		"active_run_id":   "text",
	}); err != nil {
		return err
	}
	return a.ensureTableColumns("assistant_pending_actions", map[string]string{
		"checkpoint_id":  "text",
		"interrupt_id":   "text",
		"tool_call_id":   "text",
		"tool_name":      "text",
		"execution_mode": "text default 'confirm_writes'",
		"decision":       "text",
		"decided_at":     "datetime",
	})
}

func (a *App) repairAssistantSessionTitles() error {
	rows, err := a.DB.Query(`select id,cast(coalesce(title,'') as blob) from assistant_sessions`)
	if err != nil {
		return err
	}
	type repair struct {
		id    string
		title string
	}
	repairs := make([]repair, 0)
	for rows.Next() {
		var id string
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			_ = rows.Close()
			return err
		}
		if !utf8.Valid(raw) {
			repairs = append(repairs, repair{id: id, title: strings.ToValidUTF8(string(raw), "�")})
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range repairs {
		if _, err := a.DB.Exec(`update assistant_sessions set title=? where id=?`, item.title, item.id); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) normalizePersistedRows() error {
	// Preserve a validated Smart core selection while normalizing
	// invalid/empty/legacy (e.g. alpha) values back to stable Meta.
	if _, err := a.DB.Exec(`update system_setups set mihomo_core_type='meta', updated_at=? where lower(trim(coalesce(mihomo_core_type,''))) not in ('meta','smart')`, time.Now()); err != nil {
		return err
	}
	if _, err := a.DB.Exec(`update assistant_sessions set runtime='eino',runtime_version='v0.9.15',execution_mode=case when execution_mode in ('read_only','confirm_writes','full_auto') then execution_mode else 'confirm_writes' end,status=case when status in ('idle','running','awaiting_approval','stopped','error') then status else 'idle' end,active_run_id=null where runtime is null or runtime!='eino' or runtime_version is null or runtime_version!='v0.9.15' or execution_mode not in ('read_only','confirm_writes','full_auto') or status not in ('idle','running','awaiting_approval','stopped','error')`); err != nil {
		return err
	}
	if _, err := a.DB.Exec(`update assistant_pending_actions set status='cancelled',decision='legacy_runtime',decided_at=?,call_json='[cleared]',call_hash='' where status='pending' and (checkpoint_id is null or checkpoint_id='' or interrupt_id is null or interrupt_id='')`, time.Now()); err != nil {
		return err
	}
	return nil
}

func (a *App) ensureAPITokenScopeColumn() error {
	return a.ensureTableColumns("api_tokens", map[string]string{
		"scope": "text not null default 'admin'",
	})
}

func (a *App) ensureUpdateInfoStateColumns() error {
	return a.ensureTableColumns("update_info", map[string]string{
		"phase":     "text default 'idle'",
		"message":   "text",
		"event_log": "text",
	})
}

func (a *App) ensureComponentUpdateInfoComplianceColumns() error {
	return a.ensureTableColumns("component_update_info", map[string]string{
		"download_digest":               "text",
		"verified_digest":               "text",
		"verified":                      "numeric default false",
		"verification_source":           "text",
		"installed_verified_digest":     "text",
		"installed_verification_source": "text",
		"installed_verified_at":         "datetime",
	})
}

func (a *App) ensureSystemSetupsTimezoneColumn() error {
	return a.ensureTableColumns("system_setups", map[string]string{
		"timezone": "text default 'Asia/Shanghai'",
	})
}

func (a *App) ensureSystemSetupsMihomoCoreTypeColumn() error {
	return a.ensureTableColumns("system_setups", map[string]string{
		"mihomo_core_type": "text default 'meta'",
	})
}

func (a *App) ensureTableColumns(table string, columns map[string]string) error {
	rows, err := a.DB.Query(fmt.Sprintf("pragma table_info(%s)", table))
	if err != nil {
		return err
	}
	defer rows.Close()
	existing := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		existing[name] = true
	}
	for name, definition := range columns {
		if existing[name] {
			continue
		}
		if _, err := a.DB.Exec(fmt.Sprintf("alter table %s add column %s %s", table, name, definition)); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) IsInitialized() bool {
	var ok bool
	err := a.DB.QueryRow(`select is_initialized from system_setups order by id desc limit 1`).Scan(&ok)
	return err == nil && ok
}

func (a *App) ResetAdminPassword(password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(normalizePasswordForStorage(password)), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	res, err := a.DB.Exec(`update users set password=?, updated_at=? where role='admin' and deleted_at is null`, string(hash), time.Now())
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		_, err = a.DB.Exec(`insert into users(username,password,role,is_active,created_at,updated_at) values('admin',?,'admin',true,?,?)`, string(hash), time.Now(), time.Now())
	}
	return err
}

func (a *App) createOrUpdateAdmin(username, password, email string) error {
	if username == "" || password == "" {
		return errors.New("username and password are required")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(normalizePasswordForStorage(password)), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	now := time.Now()
	_, err = a.DB.Exec(`insert into users(username,password,email,display_name,role,is_active,created_at,updated_at)
		values(?,?,?,?,?,?,?,?)
		on conflict(username) do update set password=excluded.password,email=excluded.email,role='admin',is_active=true,updated_at=excluded.updated_at,deleted_at=null`,
		username, string(hash), email, username, "admin", true, now, now)
	return err
}

func (a *App) findUserByUsername(username string) (*User, string, error) {
	row := a.DB.QueryRow(`select id, username, password, coalesce(email,''), coalesce(display_name,''), role, is_active, last_login, created_at, updated_at
		from users where username=? and deleted_at is null`, username)
	var u User
	var password string
	var last sql.NullTime
	if err := row.Scan(&u.ID, &u.Username, &password, &u.Email, &u.DisplayName, &u.Role, &u.IsActive, &last, &u.CreatedAt, &u.UpdatedAt); err != nil {
		return nil, "", err
	}
	if last.Valid {
		u.LastLogin = &last.Time
	}
	return &u, password, nil
}

func (a *App) userByID(id int64) (*User, error) {
	row := a.DB.QueryRow(`select id, username, coalesce(email,''), coalesce(display_name,''), role, is_active, last_login, created_at, updated_at
		from users where id=? and deleted_at is null`, id)
	var u User
	var last sql.NullTime
	if err := row.Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.Role, &u.IsActive, &last, &u.CreatedAt, &u.UpdatedAt); err != nil {
		return nil, err
	}
	if last.Valid {
		u.LastLogin = &last.Time
	}
	return &u, nil
}

func (a *App) audit(user *User, action, target, detail string, success bool, errText string) {
	var userID any
	var username string
	if user != nil {
		userID = user.ID
		username = user.Username
	}
	_, _ = a.DB.Exec(`insert into audit_logs(user_id,username,action,target,detail,success,error,created_at) values(?,?,?,?,?,?,?,?)`,
		userID, username, action, target, detail, success, errText, time.Now())
}
