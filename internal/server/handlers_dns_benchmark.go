package server

// DNS 上游测速：安装向导（首次部署）与面板「重新测速」共用。
//
// 候选集覆盖国内主流公共 DNS（UDP 与 IP 直连 DoH 两种形态）加上本网络
// 动态发现的上游（默认网关、resolver 配置里的 DNS），每候选 3 轮真实
// 查询（两个存在域 + 一个不存在域），剔除不可达者并按平均延迟排序，
// 最终给出跨供应商的 Top3 推荐作为并发上游池。
//
// 探测为纯读取操作（不发状态变更），向导阶段（尚无账号）也需要可用，
// 因此该端点挂在公开 API 列表中。

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type dnsBenchmarkCandidate struct {
	Name     string `json:"name"`
	Vendor   string `json:"vendor"`
	Protocol string `json:"protocol"` // udp | doh | gateway
	Addr     string `json:"addr"`     // UDP 为 host[:port]；DoH 为完整 URL
}

type dnsBenchmarkResult struct {
	dnsBenchmarkCandidate
	OK        bool    `json:"ok"`
	Successes int     `json:"successes"`
	Rounds    int     `json:"rounds"`
	AvgMs     float64 `json:"avg_ms"`
	Error     string  `json:"error,omitempty"`
}

type dnsBenchmarkResponse struct {
	Success     bool                 `json:"success"`
	Results     []dnsBenchmarkResult `json:"results"`
	Recommended []dnsBenchmarkResult `json:"recommended"`
	TookMs      int64                `json:"took_ms"`
	Note        string               `json:"note,omitempty"`
}

var dnsBuiltinCandidates = []dnsBenchmarkCandidate{
	{Name: "阿里公共DNS", Vendor: "ali", Protocol: "udp", Addr: "223.5.5.5:53"},
	{Name: "阿里公共DNS备用", Vendor: "ali", Protocol: "udp", Addr: "223.6.6.6:53"},
	{Name: "腾讯DNSPod", Vendor: "tencent", Protocol: "udp", Addr: "119.29.29.29:53"},
	{Name: "百度公共DNS", Vendor: "baidu", Protocol: "udp", Addr: "180.76.76.76:53"},
	{Name: "火山引擎DNS", Vendor: "volc", Protocol: "udp", Addr: "180.184.1.1:53"},
	{Name: "114DNS", Vendor: "114", Protocol: "udp", Addr: "114.114.114.114:53"},
	{Name: "OneDNS", Vendor: "onedns", Protocol: "udp", Addr: "117.50.10.10:53"},
	{Name: "阿里DoH", Vendor: "ali", Protocol: "doh", Addr: "https://223.5.5.5/dns-query"},
	{Name: "腾讯DoH", Vendor: "tencent", Protocol: "doh", Addr: "https://120.53.53.53/dns-query"},
	{Name: "腾讯DoH备用", Vendor: "tencent", Protocol: "doh", Addr: "https://1.12.12.12/dns-query"},
	{Name: "OneDNS DoH", Vendor: "onedns", Protocol: "doh", Addr: "https://117.50.10.10/dns-query"},
}

// dnsProbeDomains 前两个为存在域（必须 NOERROR 且带答案——只回事务头
// 的 SERVFAIL/REFUSED 上游会被这段挡下）；最后一个为不存在域：部分上游
// 对不存在域会挂起或过滤，用它把这类上游识别出来，NXDOMAIN 属健康表现。
var dnsProbeDomains = []string{"www.taobao.com", "www.qq.com", "msf-nxdomain-probe.invalid"}

const (
	dnsBenchmarkUDPRoundTimeout = 1200 * time.Millisecond
	dnsBenchmarkDoHRoundTimeout = 2500 * time.Millisecond
	dnsBenchmarkTotalTimeout    = 50 * time.Second
	dnsBenchmarkConcurrency     = 8
	dnsBenchmarkCooldown        = 5 * time.Second
)

func (a *App) handleDNSBenchmark(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	finish, retryAfter, ok := a.beginDNSBenchmark(started)
	if !ok {
		w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
		writeError(w, http.StatusTooManyRequests, "dns_benchmark_busy", "DNS 测速正在运行或请求过于频繁，请稍后重试")
		return
	}
	defer finish()
	ctx, cancel := context.WithTimeout(r.Context(), dnsBenchmarkTotalTimeout)
	defer cancel()

	candidates := append([]dnsBenchmarkCandidate{}, dnsBuiltinCandidates...)
	candidates = append(candidates, discoverGatewayCandidates()...)

	results := runDNSBenchmark(ctx, candidates)
	recommended := selectRecommendedUpstreams(results)
	note := ""
	if len(recommended) == 0 {
		note = "没有可用的上游：请检查本机出网与 UDP/443 放行情况。"
	}
	writeJSON(w, http.StatusOK, dnsBenchmarkResponse{
		Success:     true,
		Results:     results,
		Recommended: recommended,
		TookMs:      time.Since(started).Milliseconds(),
		Note:        note,
	})
}

func (a *App) beginDNSBenchmark(now time.Time) (finish func(), retryAfter int, ok bool) {
	a.dnsBenchmarkMu.Lock()
	defer a.dnsBenchmarkMu.Unlock()
	if a.dnsBenchmarkRunning {
		return nil, int(dnsBenchmarkTotalTimeout.Seconds()), false
	}
	if elapsed := now.Sub(a.dnsBenchmarkLastStarted); !a.dnsBenchmarkLastStarted.IsZero() && elapsed < dnsBenchmarkCooldown {
		retry := int((dnsBenchmarkCooldown - elapsed).Seconds())
		if retry < 1 {
			retry = 1
		}
		return nil, retry, false
	}
	a.dnsBenchmarkRunning = true
	a.dnsBenchmarkLastStarted = now
	return func() {
		a.dnsBenchmarkMu.Lock()
		a.dnsBenchmarkRunning = false
		a.dnsBenchmarkMu.Unlock()
	}, 0, true
}

// selectRecommendedUpstreams 从测速结果里挑选并发上游池：仅保留全部轮次
// 成功者，组合规则为「最多两条明文 UDP + 一条 DoH 加密兜底」——纯延迟
// 排序会让低延迟网关把加密上游挤出推荐，失去兜底能力。同一供应商最多
// 一条，避免两条上游同时故障。
func selectRecommendedUpstreams(results []dnsBenchmarkResult) []dnsBenchmarkResult {
	usable := make([]dnsBenchmarkResult, 0, len(results))
	for _, item := range results {
		if item.OK {
			usable = append(usable, item)
		}
	}
	sort.SliceStable(usable, func(i, j int) bool { return usable[i].AvgMs < usable[j].AvgMs })
	recommended := make([]dnsBenchmarkResult, 0, 3)
	seenVendor := map[string]bool{}
	seenAddr := map[string]bool{}
	pick := func(item dnsBenchmarkResult) bool {
		if seenVendor[item.Vendor] || seenAddr[item.Addr] {
			return false
		}
		seenVendor[item.Vendor] = true
		seenAddr[item.Addr] = true
		recommended = append(recommended, item)
		return true
	}
	udpCount := 0
	for _, item := range usable {
		if len(recommended) >= 3 || udpCount >= 2 {
			break
		}
		if item.Protocol == "doh" {
			continue
		}
		if pick(item) {
			udpCount++
		}
	}
	for _, item := range usable {
		if len(recommended) >= 3 {
			break
		}
		if item.Protocol != "doh" {
			continue
		}
		pick(item)
	}
	// 凑不满三条时用剩余可用者补齐（供应商去重仍然生效）。
	for _, item := range usable {
		if len(recommended) >= 3 {
			break
		}
		pick(item)
	}
	return recommended
}

func runDNSBenchmark(ctx context.Context, candidates []dnsBenchmarkCandidate) []dnsBenchmarkResult {
	results := make([]dnsBenchmarkResult, len(candidates))
	sem := make(chan struct{}, dnsBenchmarkConcurrency)
	var wg sync.WaitGroup
	for i, candidate := range candidates {
		wg.Add(1)
		go func(index int, c dnsBenchmarkCandidate) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[index] = probeCandidate(ctx, c)
		}(i, candidate)
	}
	wg.Wait()
	return results
}

func probeCandidate(ctx context.Context, c dnsBenchmarkCandidate) dnsBenchmarkResult {
	result := dnsBenchmarkResult{dnsBenchmarkCandidate: c, Rounds: len(dnsProbeDomains)}
	var total time.Duration
	successes := 0
	for i, domain := range dnsProbeDomains {
		id := uint16(0x5a00 + i)
		query := buildDNSAQuery(id, domain)
		var elapsed time.Duration
		var err error
		allowNXDomain := strings.HasSuffix(domain, ".invalid")
		requireAnswer := !allowNXDomain
		if c.Protocol == "doh" {
			elapsed, err = probeDoHOnce(ctx, c.Addr, query, allowNXDomain, requireAnswer)
		} else {
			elapsed, err = probeUDPOnce(ctx, c.Addr, query, id, allowNXDomain, requireAnswer)
		}
		if err == nil {
			successes++
			total += elapsed
		} else if result.Error == "" {
			result.Error = err.Error()
		}
	}
	result.Successes = successes
	result.OK = successes == len(dnsProbeDomains)
	if successes > 0 {
		result.AvgMs = float64(total.Milliseconds()) / float64(successes)
	}
	return result
}

func probeUDPOnce(ctx context.Context, addr string, query []byte, id uint16, allowNXDomain, requireAnswer bool) (time.Duration, error) {
	if !strings.Contains(addr, ":") {
		addr = net.JoinHostPort(addr, "53")
	}
	started := time.Now()
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "udp", addr)
	if err != nil {
		return 0, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(dnsBenchmarkUDPRoundTimeout))
	if _, err := conn.Write(query); err != nil {
		return 0, err
	}
	buf := make([]byte, 512)
	n, err := conn.Read(buf)
	if err != nil {
		return 0, err
	}
	if err := validateDNSResponse(buf[:n], id, allowNXDomain, requireAnswer); err != nil {
		return 0, err
	}
	return time.Since(started), nil
}

var dnsBenchmarkHTTPClient = &http.Client{
	Transport: &http.Transport{
		// 探测必须直连：绝不继承系统代理，否则测到的是代理而不是上游本身。
		Proxy: nil,
	},
}

func probeDoHOnce(ctx context.Context, url string, query []byte, allowNXDomain, requireAnswer bool) (time.Duration, error) {
	started := time.Now()
	ctx, cancel := context.WithTimeout(ctx, dnsBenchmarkDoHRoundTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"?dns="+base64.RawURLEncoding.EncodeToString(query), nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/dns-message")
	resp, err := dnsBenchmarkHTTPClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 512))
	if err != nil {
		return 0, err
	}
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("http %d", resp.StatusCode)
	}
	if err := validateDNSResponse(body, binary.BigEndian.Uint16(query[0:2]), allowNXDomain, requireAnswer); err != nil {
		return 0, err
	}
	return time.Since(started), nil
}

// buildDNSAQuery 构造最小 A 记录查询（RD=1），不引入外部 DNS 库依赖。
func buildDNSAQuery(id uint16, domain string) []byte {
	var head [12]byte
	binary.BigEndian.PutUint16(head[0:2], id)
	head[2] = 0x01 // RD
	head[5] = 1    // QDCOUNT
	buf := make([]byte, 0, len(domain)+18)
	buf = append(buf, head[:]...)
	for _, label := range strings.Split(domain, ".") {
		if label == "" {
			continue
		}
		buf = append(buf, byte(len(label)))
		buf = append(buf, label...)
	}
	buf = append(buf, 0)    // root
	buf = append(buf, 0, 1) // QTYPE=A
	buf = append(buf, 0, 1) // QCLASS=IN
	return buf
}

func validateDNSResponse(msg []byte, id uint16, allowNXDomain, requireAnswer bool) error {
	if len(msg) < 12 {
		return fmt.Errorf("short response")
	}
	if binary.BigEndian.Uint16(msg[0:2]) != id {
		return fmt.Errorf("mismatched transaction id")
	}
	if msg[2]&0x80 == 0 {
		return fmt.Errorf("not a response")
	}
	rcode := msg[3] & 0x0f
	if rcode != 0 && !(allowNXDomain && rcode == 3) {
		return fmt.Errorf("dns response rcode %d", rcode)
	}
	if requireAnswer && binary.BigEndian.Uint16(msg[6:8]) == 0 {
		return fmt.Errorf("dns response has no answers")
	}
	return nil
}

// discoverGatewayCandidates 发现本网络的上游候选：默认网关与本机 resolver
// 里配置的 DNS（剔除指向本机的项——那是接管后的自己，测了没有意义）。
func discoverGatewayCandidates() []dnsBenchmarkCandidate {
	var out []dnsBenchmarkCandidate
	seen := map[string]bool{}
	local := localDNSAddressSet()
	if gateway, err := defaultGateway(); err == nil && gateway != "" && !local[gateway] && !seen[gateway] {
		seen[gateway] = true
		out = append(out, dnsBenchmarkCandidate{
			Name:     "默认网关",
			Vendor:   "gateway",
			Protocol: "gateway",
			Addr:     net.JoinHostPort(gateway, "53"),
		})
	}
	if raw, err := os.ReadFile("/etc/resolv.conf"); err == nil {
		for _, ns := range resolverNameservers(string(raw)) {
			host, _, err := net.SplitHostPort(ns)
			if err != nil {
				host = ns
			}
			if host == "" || local[host] || seen[host] {
				continue
			}
			seen[host] = true
			out = append(out, dnsBenchmarkCandidate{
				Name:     "resolver DNS",
				Vendor:   "resolver",
				Protocol: "gateway",
				Addr:     net.JoinHostPort(host, "53"),
			})
		}
	}
	return out
}

// applySetupDomesticUpstreams 把向导测速选出的国内上游写入 mosdns overrides，
// 供随后的 writeGeneratedConfigs 渲染消费。空选择不覆盖既有 overrides
// （保持模板默认池或用户已保存的配置）。
func (a *App) applySetupDomesticUpstreams(cfg SetupConfig) error {
	if len(cfg.DomesticUpstreams) == 0 {
		return nil
	}
	current := a.jsonSettingWithFileFallback("mosdns_upstream_overrides", "configs/mosdns/upstream_overrides.json", map[string]any{})
	root, ok := current.(map[string]any)
	if !ok {
		root = map[string]any{}
	}
	items := make([]any, 0, len(cfg.DomesticUpstreams))
	for _, choice := range cfg.DomesticUpstreams {
		protocol := strings.ToLower(strings.TrimSpace(choice.Protocol))
		if protocol == "" || protocol == "aliapi" {
			return fmt.Errorf("domestic upstream %s has an unsupported protocol %q", choice.Name, choice.Protocol)
		}
		if strings.TrimSpace(choice.Addr) == "" {
			return fmt.Errorf("domestic upstream %s has an empty address", choice.Name)
		}
		items = append(items, map[string]any{
			"tag":      strings.TrimSpace(choice.Name),
			"enabled":  true,
			"protocol": protocol,
			"addr":     strings.TrimSpace(choice.Addr),
		})
	}
	root["domestic"] = items
	a.storeJSONSetting("mosdns_upstream_overrides", root)
	return a.writeJSONFilePrivate("configs/mosdns/upstream_overrides.json", root)
}

// defaultGateway 从 /proc/net/route 解析默认路由网关（Linux）；
// 其他平台或解析失败时返回错误，调用方跳过该候选即可。
func defaultGateway() (string, error) {
	data, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n")[1:] {
		fields := strings.Fields(line)
		if len(fields) < 3 || fields[1] != "00000000" {
			continue
		}
		hex := fields[2]
		if len(hex) != 8 {
			continue
		}
		var octets [4]byte
		for i := 0; i < 4; i++ {
			var v byte
			if _, err := fmt.Sscanf(hex[i*2:i*2+2], "%02x", &v); err != nil {
				return "", err
			}
			octets[3-i] = v
		}
		gateway := net.IP(octets[:]).String()
		if gateway != "0.0.0.0" {
			return gateway, nil
		}
	}
	return "", fmt.Errorf("no default gateway")
}
