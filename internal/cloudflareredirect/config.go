package cloudflareredirect

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const defaultConfigYAML = `enabled: false

scan:
  interval: 6h
  concurrency: 100
  timeout: 1s
  max_duration: 2s
  test_domain: cloudflaremirrors.com/debian
  expected_status: 200
  port: 443
  tls: true
  colo_allowlist: []

  ipv4:
    enabled: true
    candidate_source: baipiao
    result_count: 2
    random_per_cidr: 1

  ipv6:
    enabled: auto
    candidate_source: baipiao
    result_count: 2
    random_per_cidr: 1
    no_winner_policy: passthrough

rules:
  manual:
    - domain:m-team.cc
    - domain:m-team.io
    - domain:open.cd
    - domain:hdfans.org
    - domain:hhanclub.net
    - domain:audiences.me
    - domain:plex.tv
    - domain:hdsky.me
    - domain:parsec.app
    - domain:ourbits.club
    - full:springsunday.net
    - full:www.springsunday.net
    - domain:pterclub.net
    - domain:ptskit.org
    - domain:totheglory.im
  subscriptions: []

apply:
  ttl: 60
  rewrite_a: true
  rewrite_aaaa: auto
  restart_mosdns: auto
`

type TriState string

const (
	TriFalse TriState = "false"
	TriTrue  TriState = "true"
	TriAuto  TriState = "auto"
)

func (t *TriState) UnmarshalYAML(value *yaml.Node) error {
	raw := strings.TrimSpace(value.Value)
	if raw == "" {
		*t = TriFalse
		return nil
	}
	switch strings.ToLower(raw) {
	case "true", "yes", "on", "a":
		*t = TriTrue
	case "false", "no", "off", "b":
		*t = TriFalse
	case "auto":
		*t = TriAuto
	default:
		return fmt.Errorf("invalid tristate value %q", value.Value)
	}
	return nil
}

func (t TriState) Enabled(autoDefault bool) bool {
	switch t {
	case TriTrue:
		return true
	case TriAuto:
		return autoDefault
	default:
		return false
	}
}

type Config struct {
	Enabled bool        `yaml:"enabled" json:"enabled"`
	Scan    ScanConfig  `yaml:"scan" json:"scan"`
	Rules   RulesConfig `yaml:"rules" json:"rules"`
	Apply   ApplyConfig `yaml:"apply" json:"apply"`
}

type ScanConfig struct {
	Interval      string           `yaml:"interval" json:"interval"`
	Concurrency   int              `yaml:"concurrency" json:"concurrency"`
	Timeout       string           `yaml:"timeout" json:"timeout"`
	MaxDuration   string           `yaml:"max_duration" json:"max_duration"`
	TestDomain    string           `yaml:"test_domain" json:"test_domain"`
	ExpectedCode  int              `yaml:"expected_status" json:"expected_status"`
	Port          int              `yaml:"port" json:"port"`
	TLS           bool             `yaml:"tls" json:"tls"`
	ColoAllowlist []string         `yaml:"colo_allowlist" json:"colo_allowlist"`
	IPv4          FamilyScanConfig `yaml:"ipv4" json:"ipv4"`
	IPv6          FamilyScanConfig `yaml:"ipv6" json:"ipv6"`
}

type FamilyScanConfig struct {
	Enabled         TriState `yaml:"enabled" json:"enabled"`
	CandidateSource string   `yaml:"candidate_source" json:"candidate_source"`
	ResultCount     int      `yaml:"result_count" json:"result_count"`
	RandomPerCIDR   int      `yaml:"random_per_cidr" json:"random_per_cidr"`
	NoWinnerPolicy  string   `yaml:"no_winner_policy" json:"no_winner_policy"`
}

type RulesConfig struct {
	Manual        []string             `yaml:"manual" json:"manual"`
	Subscriptions []SubscriptionConfig `yaml:"subscriptions" json:"subscriptions"`
}

type SubscriptionConfig struct {
	Name     string `yaml:"name" json:"name"`
	Enabled  bool   `yaml:"enabled" json:"enabled"`
	URL      string `yaml:"url" json:"url"`
	Format   string `yaml:"format" json:"format"`
	Interval string `yaml:"interval" json:"interval"`
}

type ApplyConfig struct {
	TTL           int      `yaml:"ttl" json:"ttl"`
	RewriteA      bool     `yaml:"rewrite_a" json:"rewrite_a"`
	RewriteAAAA   TriState `yaml:"rewrite_aaaa" json:"rewrite_aaaa"`
	RestartMosDNS TriState `yaml:"restart_mosdns" json:"restart_mosdns"`
}

type State struct {
	BestIPv4    []ScanResult `json:"best_ipv4"`
	BestIPv6    []ScanResult `json:"best_ipv6"`
	LastScanAt  time.Time    `json:"last_scan_at,omitempty"`
	LastApplyAt time.Time    `json:"last_apply_at,omitempty"`
	LastError   string       `json:"last_error,omitempty"`
	DomainCount int          `json:"domain_count"`
	Injected    bool         `json:"injected"`
	UpdatedAt   time.Time    `json:"updated_at,omitempty"`
}

type ScanResult struct {
	IP        string    `json:"ip"`
	Family    string    `json:"family"`
	LatencyMS int64     `json:"latency_ms"`
	Colo      string    `json:"colo,omitempty"`
	Region    string    `json:"region,omitempty"`
	City      string    `json:"city,omitempty"`
	Source    string    `json:"source,omitempty"`
	ScannedAt time.Time `json:"scanned_at"`
}

func ConfigPath(dataDir string) string {
	return filepath.Join(dataDir, "configs/cloudflare-redirect/cfyouxuan.yaml")
}

func StatePath(dataDir string) string {
	return filepath.Join(dataDir, "data/cloudflare-redirect/state.json")
}

func PIDPath(dataDir string) string {
	return filepath.Join(dataDir, "data/cloudflare-redirect/cloudflare-redirect.pid")
}

func LogPath(dataDir string) string {
	return filepath.Join(dataDir, "logs/cloudflare-redirect.log")
}

func RulePath(dataDir string) string {
	return filepath.Join(dataDir, "configs/mosdns/rule/cloudflare_redirect.txt")
}

func RulePathV6(dataDir string) string {
	return filepath.Join(dataDir, "configs/mosdns/rule/cloudflare_redirect_v6.txt")
}

func SubConfigPath(dataDir string) string {
	return filepath.Join(dataDir, "configs/mosdns/sub_config/cloudflare_redirect.yaml")
}

func MosDNSConfigPath(dataDir string) string {
	return filepath.Join(dataDir, "configs/mosdns/config.yaml")
}

func EnsureDefaultConfig(dataDir string) error {
	for _, dir := range []string{
		filepath.Dir(ConfigPath(dataDir)),
		filepath.Dir(StatePath(dataDir)),
		filepath.Dir(LogPath(dataDir)),
		filepath.Dir(RulePath(dataDir)),
		filepath.Dir(SubConfigPath(dataDir)),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	cfg := ConfigPath(dataDir)
	if _, err := os.Stat(cfg); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.WriteFile(cfg, []byte(defaultConfigYAML), 0o644)
}

func LoadConfig(dataDir string) (Config, error) {
	b, err := os.ReadFile(ConfigPath(dataDir))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Config{}, fmt.Errorf("cloudflare redirect config not found at %s; run msf init first or create the file", ConfigPath(dataDir))
		}
		return Config{}, err
	}
	cfg := defaultConfig()
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return Config{}, err
	}
	cfg.withDefaults()
	return cfg, nil
}

func defaultConfig() Config {
	var cfg Config
	_ = yaml.Unmarshal([]byte(defaultConfigYAML), &cfg)
	return cfg
}

func (cfg *Config) withDefaults() {
	if cfg.Scan.Interval == "" {
		cfg.Scan.Interval = "6h"
	}
	if cfg.Scan.Concurrency <= 0 {
		cfg.Scan.Concurrency = 100
	}
	if cfg.Scan.Timeout == "" {
		cfg.Scan.Timeout = "1s"
	}
	if cfg.Scan.MaxDuration == "" {
		cfg.Scan.MaxDuration = "2s"
	}
	if cfg.Scan.TestDomain == "" {
		cfg.Scan.TestDomain = "cloudflaremirrors.com/debian"
	}
	if cfg.Scan.ExpectedCode == 0 {
		cfg.Scan.ExpectedCode = 200
	}
	if cfg.Scan.Port == 0 {
		cfg.Scan.Port = 443
	}
	if cfg.Scan.IPv4.Enabled == "" {
		cfg.Scan.IPv4.Enabled = TriTrue
	}
	if cfg.Scan.IPv4.CandidateSource == "" {
		cfg.Scan.IPv4.CandidateSource = "baipiao"
	}
	if cfg.Scan.IPv4.ResultCount <= 0 {
		cfg.Scan.IPv4.ResultCount = 2
	}
	if cfg.Scan.IPv4.RandomPerCIDR <= 0 {
		cfg.Scan.IPv4.RandomPerCIDR = 1
	}
	if cfg.Scan.IPv6.Enabled == "" {
		cfg.Scan.IPv6.Enabled = TriAuto
	}
	if cfg.Scan.IPv6.CandidateSource == "" {
		cfg.Scan.IPv6.CandidateSource = "baipiao"
	}
	if cfg.Scan.IPv6.ResultCount <= 0 {
		cfg.Scan.IPv6.ResultCount = 2
	}
	if cfg.Scan.IPv6.RandomPerCIDR <= 0 {
		cfg.Scan.IPv6.RandomPerCIDR = 1
	}
	if cfg.Scan.IPv6.NoWinnerPolicy == "" {
		cfg.Scan.IPv6.NoWinnerPolicy = "passthrough"
	}
	if cfg.Apply.TTL <= 0 {
		cfg.Apply.TTL = 60
	}
	if cfg.Apply.RewriteAAAA == "" {
		cfg.Apply.RewriteAAAA = TriAuto
	}
	if cfg.Apply.RestartMosDNS == "" {
		cfg.Apply.RestartMosDNS = TriAuto
	}
}

func ParseDuration(raw string, fallback time.Duration) time.Duration {
	if d, err := time.ParseDuration(strings.TrimSpace(raw)); err == nil && d > 0 {
		return d
	}
	return fallback
}

func LoadState(dataDir string) (State, error) {
	b, err := os.ReadFile(StatePath(dataDir))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return State{}, nil
		}
		return State{}, err
	}
	var st State
	if err := json.Unmarshal(b, &st); err != nil {
		return State{}, err
	}
	return st, nil
}

func SaveState(dataDir string, st State) error {
	st.UpdatedAt = time.Now()
	path := StatePath(dataDir)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o644)
}

func readPID(path string) int {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return pid
}
