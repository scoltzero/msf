package cloudflareredirect

import (
	"bufio"
	"context"
	crand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	baipiaoIPv4URL   = "https://www.baipiao.eu.org/cloudflare/ips-v4"
	baipiaoIPv6URL   = "https://www.baipiao.eu.org/cloudflare/ips-v6"
	baipiaoLocations = "https://www.baipiao.eu.org/cloudflare/locations"
	officialIPv4URL  = "https://www.cloudflare.com/ips-v4"
	officialIPv6URL  = "https://www.cloudflare.com/ips-v6"
)

type cfLocation struct {
	Iata   string  `json:"iata"`
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
	Cca2   string  `json:"cca2"`
	Region string  `json:"region"`
	City   string  `json:"city"`
}

func Scan(ctx context.Context, dataDir string, cfg Config) (State, error) {
	st, _ := LoadState(dataDir)
	locations := loadLocations(ctx)
	var errParts []string
	if cfg.Scan.IPv4.Enabled.Enabled(true) {
		results, err := scanFamily(ctx, cfg, cfg.Scan.IPv4, "ipv4", locations)
		if err != nil {
			errParts = append(errParts, "ipv4: "+err.Error())
		}
		st.BestIPv4 = results
	}
	if cfg.Scan.IPv6.Enabled.Enabled(autoIPv6Enabled(dataDir)) {
		results, err := scanFamily(ctx, cfg, cfg.Scan.IPv6, "ipv6", locations)
		if err != nil {
			errParts = append(errParts, "ipv6: "+err.Error())
		}
		st.BestIPv6 = results
	}
	st.LastScanAt = time.Now()
	st.LastError = strings.Join(errParts, "; ")
	if err := SaveState(dataDir, st); err != nil {
		return st, err
	}
	if len(errParts) > 0 {
		return st, errors.New(strings.Join(errParts, "; "))
	}
	return st, nil
}

func scanFamily(ctx context.Context, cfg Config, family FamilyScanConfig, familyName string, locations map[string]cfLocation) ([]ScanResult, error) {
	cidrs, source, err := fetchCandidates(ctx, family.CandidateSource, familyName)
	if err != nil {
		return nil, err
	}
	candidates := sampleCandidateIPs(cidrs, familyName, family.RandomPerCIDR)
	if len(candidates) == 0 {
		return nil, fmt.Errorf("no candidate IPs from %s", source)
	}
	timeout := ParseDuration(cfg.Scan.Timeout, time.Second)
	maxDuration := ParseDuration(cfg.Scan.MaxDuration, 2*time.Second)
	allowColo := map[string]bool{}
	for _, colo := range cfg.Scan.ColoAllowlist {
		colo = strings.ToUpper(strings.TrimSpace(colo))
		if colo != "" {
			allowColo[colo] = true
		}
	}
	type item struct {
		result ScanResult
		ok     bool
	}
	work := make(chan string)
	done := make(chan item)
	workers := cfg.Scan.Concurrency
	if workers <= 0 {
		workers = 100
	}
	if workers > len(candidates) {
		workers = len(candidates)
	}
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ip := range work {
				result, ok := probeCandidate(ctx, cfg, familyName, ip, source, locations, timeout, maxDuration)
				if ok {
					if len(allowColo) > 0 && !allowColo[strings.ToUpper(result.Colo)] {
						continue
					}
					done <- item{result: result, ok: true}
				}
			}
		}()
	}
	go func() {
	sendLoop:
		for _, ip := range candidates {
			select {
			case <-ctx.Done():
				break sendLoop
			case work <- ip:
			}
		}
		close(work)
		wg.Wait()
		close(done)
	}()
	var results []ScanResult
	for item := range done {
		if item.ok {
			results = append(results, item.result)
		}
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].LatencyMS < results[j].LatencyMS
	})
	limit := family.ResultCount
	if limit <= 0 {
		limit = 2
	}
	if len(results) > limit {
		results = results[:limit]
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("no valid %s Cloudflare edge IP found", familyName)
	}
	return results, nil
}

func fetchCandidates(ctx context.Context, source, family string) ([]string, string, error) {
	urls := candidateURLs(source, family)
	var lastErr error
	for _, item := range urls {
		lines, err := fetchLines(ctx, item.url)
		if err == nil && len(lines) > 0 {
			return lines, item.name, nil
		}
		if err != nil {
			lastErr = err
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("empty candidate source")
	}
	return nil, "", lastErr
}

func candidateURLs(source, family string) []struct{ name, url string } {
	source = strings.TrimSpace(source)
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		return []struct{ name, url string }{{"custom", source}}
	}
	if strings.EqualFold(source, "cloudflare") || strings.EqualFold(source, "official") {
		if family == "ipv6" {
			return []struct{ name, url string }{{"cloudflare-official", officialIPv6URL}}
		}
		return []struct{ name, url string }{{"cloudflare-official", officialIPv4URL}}
	}
	if family == "ipv6" {
		return []struct{ name, url string }{
			{"baipiao", baipiaoIPv6URL},
			{"cloudflare-official", officialIPv6URL},
		}
	}
	return []struct{ name, url string }{
		{"baipiao", baipiaoIPv4URL},
		{"cloudflare-official", officialIPv4URL},
	}
}

func fetchLines(ctx context.Context, rawURL string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s returned http %d", rawURL, resp.StatusCode)
	}
	var out []string
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := stripInlineComment(strings.TrimSpace(scanner.Text()))
		if line != "" {
			out = append(out, line)
		}
	}
	return out, scanner.Err()
}

func sampleCandidateIPs(lines []string, family string, perCIDR int) []string {
	if perCIDR <= 0 {
		perCIDR = 1
	}
	seen := map[string]bool{}
	var out []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.Contains(line, "/") {
			prefix, err := netip.ParsePrefix(line)
			if err != nil {
				continue
			}
			if family == "ipv4" && !prefix.Addr().Is4() {
				continue
			}
			if family == "ipv6" && !prefix.Addr().Is6() {
				continue
			}
			for i := 0; i < perCIDR; i++ {
				ip, err := randomIPInPrefix(prefix)
				if err == nil && !seen[ip] {
					seen[ip] = true
					out = append(out, ip)
				}
			}
			continue
		}
		addr, err := netip.ParseAddr(line)
		if err != nil {
			continue
		}
		if family == "ipv4" && !addr.Is4() {
			continue
		}
		if family == "ipv6" && !addr.Is6() {
			continue
		}
		ip := addr.String()
		if !seen[ip] {
			seen[ip] = true
			out = append(out, ip)
		}
	}
	return out
}

func randomIPInPrefix(prefix netip.Prefix) (string, error) {
	bits := 128
	addr := prefix.Addr()
	if addr.Is4() {
		bits = 32
	}
	hostBits := bits - prefix.Bits()
	if hostBits < 0 {
		hostBits = 0
	}
	baseBytes := addr.As16()
	if addr.Is4() {
		v4 := addr.As4()
		baseBytes = [16]byte{}
		copy(baseBytes[12:], v4[:])
	}
	base := new(big.Int).SetBytes(baseBytes[:])
	if hostBits > 0 {
		hostMask := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), uint(hostBits)), big.NewInt(1))
		base.AndNot(base, hostMask)
		max := new(big.Int).Lsh(big.NewInt(1), uint(hostBits))
		n, err := crand.Int(crand.Reader, max)
		if err != nil {
			return "", err
		}
		base.Or(base, n)
	}
	raw := base.FillBytes(make([]byte, 16))
	var out netip.Addr
	if addr.Is4() {
		var v4 [4]byte
		copy(v4[:], raw[12:])
		out = netip.AddrFrom4(v4)
	} else {
		var v6 [16]byte
		copy(v6[:], raw)
		out = netip.AddrFrom16(v6)
	}
	return out.String(), nil
}

func probeCandidate(ctx context.Context, cfg Config, family, ip, source string, locations map[string]cfLocation, dialTimeout, requestTimeout time.Duration) (ScanResult, bool) {
	target, host, err := testURL(cfg)
	if err != nil {
		return ScanResult{}, false
	}
	dialer := &net.Dialer{Timeout: dialTimeout, KeepAlive: 0}
	start := time.Now()
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip, fmt.Sprint(cfg.Scan.Port)))
	if err != nil {
		return ScanResult{}, false
	}
	latency := time.Since(start)
	_ = conn.Close()
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialer.DialContext(ctx, network, net.JoinHostPort(ip, fmt.Sprint(cfg.Scan.Port)))
		},
		DisableKeepAlives: true,
	}
	client := &http.Client{Transport: transport, Timeout: requestTimeout}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return ScanResult{}, false
	}
	req.Host = host
	req.Header.Set("User-Agent", "msf-cloudflare-redirect/1")
	resp, err := client.Do(req)
	if err != nil {
		return ScanResult{}, false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
	if cfg.Scan.ExpectedCode > 0 && resp.StatusCode != cfg.Scan.ExpectedCode {
		return ScanResult{}, false
	}
	colo := parseCFRayColo(resp.Header.Get("CF-RAY"))
	if colo == "" {
		return ScanResult{}, false
	}
	loc := locations[colo]
	return ScanResult{
		IP:        ip,
		Family:    family,
		LatencyMS: latency.Milliseconds(),
		Colo:      colo,
		Region:    loc.Region,
		City:      loc.City,
		Source:    source,
		ScannedAt: time.Now(),
	}, true
}

func testURL(cfg Config) (string, string, error) {
	raw := strings.TrimSpace(cfg.Scan.TestDomain)
	if !strings.Contains(raw, "://") {
		scheme := "http"
		if cfg.Scan.TLS {
			scheme = "https"
		}
		raw = scheme + "://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", "", err
	}
	if u.Host == "" {
		return "", "", fmt.Errorf("invalid test_domain %q", cfg.Scan.TestDomain)
	}
	return u.String(), u.Hostname(), nil
}

func parseCFRayColo(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parts := strings.Split(value, "-")
	if len(parts) < 2 {
		return ""
	}
	return strings.ToUpper(strings.TrimSpace(parts[len(parts)-1]))
}

func loadLocations(ctx context.Context) map[string]cfLocation {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baipiaoLocations, nil)
	if err != nil {
		return map[string]cfLocation{}
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]cfLocation{}
	}
	defer resp.Body.Close()
	var list []cfLocation
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return map[string]cfLocation{}
	}
	out := map[string]cfLocation{}
	for _, item := range list {
		if item.Iata != "" {
			out[strings.ToUpper(item.Iata)] = item
		}
	}
	return out
}

func autoIPv6Enabled(dataDir string) bool {
	b, err := os.ReadFile(filepath.Join(dataDir, "configs/mosdns/rule/switch6.txt"))
	if err != nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(string(b)), "B")
}
