package server

import (
	"compress/gzip"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	logfmtFieldRE        = regexp.MustCompile(`([A-Za-z_][A-Za-z0-9_-]*)=("[^"]*"|\S+)`)
	leadingDateTimeRE    = regexp.MustCompile(`^\s*(\d{4}[-/]\d{2}[-/]\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\s+(.*))?$`)
	leadingRFC3339TimeRE = regexp.MustCompile(`^\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))(?:\s+(.*))?$`)
	cacheDomainRE        = regexp.MustCompile(`[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}\.)+[A-Za-z]{2,}\.?`)
)

func (a *App) mosDNSAPIBase() string {
	base := strings.TrimRight(a.setting("mosdns_api_endpoint", "http://127.0.0.1:9099"), "/")
	if base == "" {
		return "http://127.0.0.1:9099"
	}
	if _, err := url.ParseRequestURI(base); err != nil {
		return "http://127.0.0.1:9099"
	}
	return base
}

func (a *App) mosDNSAPIURL(path string) string {
	if path == "" {
		return a.mosDNSAPIBase()
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return a.mosDNSAPIBase() + path
}

func (a *App) mosDNSSnapshot(limit int) map[string]any {
	st := a.Services.Status("mosdns")
	entries := a.mosDNSQueryDataset(limit)
	audit := mosDNSAuditStats(entries)
	cache := mosDNSCacheSummary(entries)
	metrics, metricsOK := a.mosDNSProxyMetrics()
	cacheCounters := mosDNSMetricCacheCounters(metrics)
	if metricsOK && len(cacheCounters) > 0 {
		cache = mosDNSCacheSummaryFromRows(a.mosDNSCacheOverviewRows(cacheCounters, entries))
	}
	if remoteCache, ok := a.mosDNSProxyCache(); ok {
		if summary, ok := remoteCache["summary"].(map[string]any); ok {
			cache = summary
		} else {
			cache = remoteCache
		}
	}
	upstreamSummary := mosDNSUpstreamStats(entries)
	upstreamRows := anyMapSlice(upstreamSummary["upstreams"])
	remoteStats, remoteOK := a.mosDNSProxyStats()
	queryCount := len(entries)
	if remoteOK {
		if v, ok := firstNumeric(remoteStats, "query_count", "total_queries", "queries", "total"); ok {
			queryCount = int(v)
		}
	}
	clientCount := int(a.countTable("mosdns_clients"))
	if clientCount == 0 {
		clientCount = len(uniqueValues(entries, "client_ip", 0))
	}
	cacheEntries := cache["entries"]
	if cacheEntries == nil {
		cacheEntries = cache["size"]
	}
	detailedCache := map[string]any{
		"summary": cache,
		"entries": mosDNSCacheRows(entries),
		"items":   mosDNSCacheRows(entries),
		"caches":  a.mosDNSCacheOverviewRows(cacheCounters, entries),
	}
	if remoteCache, ok := a.mosDNSProxyCache(); ok {
		detailedCache = remoteCache
		if _, ok := detailedCache["summary"]; !ok {
			detailedCache["summary"] = cache
		}
		if _, ok := detailedCache["caches"]; !ok {
			detailedCache["caches"] = a.mosDNSCacheOverviewRows(cacheCounters, entries)
		}
	}
	stats := map[string]any{
		"cpu_percent":         st.CPU,
		"process_rss_bytes":   normalizeMemoryBytes(st.Memory),
		"go_goroutines":       0,
		"go_gc_count":         0,
		"go_gc_duration_sec":  0,
		"go_threads":          0,
		"open_fds":            0,
		"max_fds":             0,
		"cache_query_total":   queryCount,
		"cache_hit_total":     numericAny(cache["hit_total"]),
		"average_duration_ms": numericAny(audit["average_duration_ms"]),
	}
	if remoteOK {
		for key, value := range remoteStats {
			stats[key] = value
		}
	}
	if metricsOK {
		for key, value := range metrics {
			if key == "cache_counters" {
				continue
			}
			stats[key] = value
		}
	}
	data := map[string]any{
		"service":                st,
		"status":                 st.Status,
		"running":                st.Running,
		"installed":              st.Installed,
		"pid":                    st.PID,
		"cpu":                    st.CPU,
		"memory":                 st.Memory,
		"uptime":                 st.Uptime,
		"version":                st.Version,
		"clients":                clientCount,
		"client_count":           clientCount,
		"client_ips":             a.countTable("mosdns_client_ips"),
		"switches":               a.mosDNSSwitchMap(),
		"api_endpoint":           a.mosDNSAPIBase(),
		"dns_listen":             ":53",
		"query_count":            queryCount,
		"cache_entries":          cacheEntries,
		"cache":                  cache,
		"detailed_cache":         detailedCache,
		"audit":                  audit,
		"audit_stats":            audit,
		"audit_ranks":            map[string]any{"domain": audit["top_domains"], "client": audit["top_clients"], "rule": audit["top_rules"], "domain_set": audit["top_rules"]},
		"stats":                  stats,
		"upstream_stats":         upstreamRows,
		"upstream_summary":       upstreamSummary,
		"upstream_stats_summary": upstreamSummary,
		"top_domains":            audit["top_domains"],
		"top_clients":            audit["top_clients"],
		"top_rules":              audit["top_rules"],
		"meta":                   mosDNSQueryMeta(entries),
		"source":                 "fallback",
	}
	if remoteOK {
		data["source"] = "mosdns_9099"
		data["remote"] = remoteStats
	}
	return data
}

func normalizeMemoryBytes(value int64) int64 {
	if value <= 0 {
		return 0
	}
	if value < 1_000_000 {
		return value * 1024 * 1024
	}
	return value
}

func numericAny(value any) float64 {
	switch v := value.(type) {
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case float64:
		return v
	case json.Number:
		n, _ := v.Float64()
		return n
	case string:
		n, _ := strconv.ParseFloat(v, 64)
		return n
	default:
		return 0
	}
}

func (a *App) mosDNSProxyStats() (map[string]any, bool) {
	for _, path := range []string{"/api/stats", "/stats", "/webinfo", "/plugins/webinfo/get", "/metrics"} {
		var raw any
		if proxyJSON(a.mosDNSAPIURL(path), &raw) {
			if normalized := normalizeMapPayload(raw); len(normalized) > 0 {
				return normalized, true
			}
		}
	}
	return nil, false
}

func (a *App) mosDNSProxyCache() (map[string]any, bool) {
	for _, path := range []string{"/api/cache", "/cache", "/cache/detailed", "/plugins/cache/get"} {
		var raw any
		if proxyJSON(a.mosDNSAPIURL(path), &raw) {
			if normalized := normalizeMapPayload(raw); len(normalized) > 0 {
				if _, ok := normalized["entries"]; !ok {
					if rows, ok := normalized["caches"].([]any); ok {
						normalized["entries"] = len(rows)
					}
					if rows, ok := normalized["items"].([]any); ok {
						normalized["entries"] = len(rows)
					}
				}
				return normalized, true
			}
		}
	}
	return nil, false
}

func (a *App) mosDNSProxyMetrics() (map[string]any, bool) {
	text, ok := proxyText(a.mosDNSAPIURL("/metrics"))
	if !ok || strings.TrimSpace(text) == "" {
		return nil, false
	}
	parsed := parsePrometheusMetrics(text)
	return parsed, len(parsed) > 0
}

func parsePrometheusMetrics(text string) map[string]any {
	stats := map[string]any{}
	cacheCounters := map[string]map[string]any{}
	lines := strings.Split(text, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		series := fields[0]
		value, err := strconv.ParseFloat(fields[len(fields)-1], 64)
		if err != nil {
			continue
		}
		name, labels := splitPrometheusSeries(series)
		if name == "" {
			continue
		}
		switch name {
		case "go_goroutines":
			stats["go_goroutines"] = value
		case "go_threads":
			stats["go_threads"] = value
		case "go_memstats_heap_alloc_bytes", "go_memstats_alloc_bytes":
			stats["go_heap_alloc_bytes"] = value
		case "go_memstats_heap_idle_bytes":
			stats["go_heap_idle_bytes"] = value
		case "go_memstats_heap_objects":
			stats["go_heap_objects"] = value
		case "go_gc_duration_seconds_sum":
			stats["go_gc_duration_sec"] = value
		case "go_gc_duration_seconds_count":
			stats["go_gc_count"] = value
		case "process_open_fds":
			stats["open_fds"] = value
		case "process_max_fds":
			stats["max_fds"] = value
		case "process_resident_memory_bytes":
			stats["process_rss_bytes"] = value
		}
		if strings.HasPrefix(name, "mosdns_cache_") {
			tag := labels["tag"]
			if tag == "" {
				continue
			}
			row := cacheCounters[tag]
			if row == nil {
				row = map[string]any{"tag": tag, "name": tag}
				cacheCounters[tag] = row
			}
			switch name {
			case "mosdns_cache_query_total":
				row["query_total"] = value
				row["total"] = value
			case "mosdns_cache_hit_total":
				row["hit_total"] = value
				row["hits"] = value
			case "mosdns_cache_lazy_hit_total":
				row["stale_hit_total"] = value
				row["lazy_hit_total"] = value
				row["stale_hits"] = value
			case "mosdns_cache_size_current":
				row["entries"] = value
				row["size"] = value
				row["entry_count"] = value
			}
		}
	}
	for _, row := range cacheCounters {
		fillMosDNSCacheRates(row)
	}
	if len(cacheCounters) > 0 {
		stats["cache_counters"] = cacheCounters
	}
	return stats
}

func splitPrometheusSeries(series string) (string, map[string]string) {
	labels := map[string]string{}
	idx := strings.IndexByte(series, '{')
	if idx < 0 {
		return series, labels
	}
	name := strings.TrimSpace(series[:idx])
	end := strings.LastIndexByte(series, '}')
	if end <= idx {
		return name, labels
	}
	rawLabels := series[idx+1 : end]
	for _, part := range strings.Split(rawLabels, ",") {
		key, value, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"`)
		value = strings.ReplaceAll(value, `\"`, `"`)
		value = strings.ReplaceAll(value, `\\`, `\`)
		if key != "" {
			labels[key] = value
		}
	}
	return name, labels
}

func mosDNSMetricCacheCounters(metrics map[string]any) map[string]map[string]any {
	raw, _ := metrics["cache_counters"].(map[string]map[string]any)
	if raw != nil {
		return raw
	}
	out := map[string]map[string]any{}
	if m, ok := metrics["cache_counters"].(map[string]any); ok {
		for tag, value := range m {
			if row, ok := value.(map[string]any); ok {
				out[tag] = row
			}
		}
	}
	return out
}

func (a *App) mosDNSCacheOverviewRows(counters map[string]map[string]any, entries []map[string]any) map[string]any {
	rows := map[string]any{
		"all":      a.mosDNSCacheOverviewRow("全部缓存", []string{"cache_all", "cache_all_noleak"}, counters, entries, "all"),
		"domestic": a.mosDNSCacheOverviewRow("国内缓存", []string{"cache_cn", "cache_cnmihomo"}, counters, entries, "domestic"),
		"foreign":  a.mosDNSCacheOverviewRow("国外缓存", []string{"cache_google"}, counters, entries, "foreign"),
		"node":     a.mosDNSCacheOverviewRow("节点缓存", []string{"cache_node", "cache_google_node"}, counters, entries, "node"),
	}
	return rows
}

func (a *App) mosDNSCacheDomainBuckets(_ []map[string]any) map[string]any {
	return map[string]any{
		"realIp": a.mosDNSGeneratedDomainRows([]string{"realiplist.txt"}, 1000),
		"fakeIp": a.mosDNSGeneratedDomainRows([]string{"fakeiplist.txt"}, 1000),
		"noV4":   a.mosDNSGeneratedDomainRows([]string{"nov4list.txt"}, 1000),
		"noV6":   a.mosDNSGeneratedDomainRows([]string{"nov6list.txt"}, 1000),
	}
}

func (a *App) mosDNSGeneratedDomainRows(names []string, limit int) []map[string]any {
	seen := map[string]bool{}
	var rows []map[string]any
	for _, name := range names {
		rel := filepath.ToSlash(filepath.Join("configs/mosdns/gen", name))
		content, _ := a.readTextFile(rel)
		for _, line := range splitNonEmptyLines(content) {
			domain, date := parseMosDNSGeneratedDomainLine(line)
			if domain == "" || seen[domain] {
				continue
			}
			seen[domain] = true
			row := map[string]any{
				"id":     fmt.Sprintf("%010d", len(rows)+1),
				"domain": domain,
				"source": name,
			}
			if date != "" {
				row["date"] = date
			}
			rows = append(rows, row)
			if limit > 0 && len(rows) >= limit {
				return rows
			}
		}
	}
	return rows
}

func parseMosDNSGeneratedDomainLine(line string) (string, string) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", ""
	}
	date := ""
	if match := leadingDateTimeRE.FindStringSubmatch(line); len(match) > 1 {
		date = strings.ReplaceAll(match[1], "/", "-")
	} else if match := leadingRFC3339TimeRE.FindStringSubmatch(line); len(match) > 1 {
		date = match[1][:10]
	}
	for _, raw := range cacheDomainRE.FindAllString(line, -1) {
		if domain := normalizeCacheDomainCandidate(raw); domain != "" {
			return domain, date
		}
	}
	return "", date
}

func mosDNSCacheDomainStats(domains map[string]any) map[string]any {
	stats := map[string]any{
		"realIp":       0,
		"fakeIp":       0,
		"noV4":         0,
		"noV6":         0,
		"totalDomains": 0,
	}
	total := 0
	for _, key := range []string{"realIp", "fakeIp", "noV4", "noV6"} {
		count := len(anyMapSlice(domains[key]))
		stats[key] = count
		total += count
	}
	stats["totalDomains"] = total
	return stats
}

func (a *App) mosDNSCacheDumpDomainRows(tags []string, limit int) []map[string]any {
	seen := map[string]bool{}
	var rows []map[string]any
	for _, tag := range tags {
		for _, domain := range a.mosDNSCacheDumpDomains(tag, limit) {
			if domain == "" || seen[domain] {
				continue
			}
			seen[domain] = true
			rows = append(rows, map[string]any{
				"id":     fmt.Sprintf("%010d", len(rows)+1),
				"domain": domain,
				"source": tag,
			})
			if limit > 0 && len(rows) >= limit {
				return rows
			}
		}
	}
	return rows
}

func (a *App) mosDNSCacheOverviewRow(title string, tags []string, counters map[string]map[string]any, entries []map[string]any, bucket string) map[string]any {
	row := map[string]any{"name": title, "title": title, "tags": tags}
	var queryTotal, hitTotal, staleHitTotal, entryCount float64
	usedMetrics := false
	for _, tag := range tags {
		counter := counters[tag]
		if len(counter) > 0 {
			usedMetrics = true
		}
		queryTotal += numericAny(counter["query_total"])
		hitTotal += numericAny(counter["hit_total"])
		staleHitTotal += firstNumberAny(counter, "stale_hit_total", "lazy_hit_total", "stale_hits")
		entryCount += firstNumberAny(counter, "entries", "size", "entry_count")
	}
	if entryCount == 0 {
		for _, tag := range tags {
			entryCount += float64(a.mosDNSCacheDumpEntryCount(tag))
		}
	}
	if !usedMetrics || (queryTotal == 0 && hitTotal == 0 && staleHitTotal == 0 && entryCount == 0 && len(entries) > 0) {
		queryTotal, hitTotal, staleHitTotal = mosDNSCacheFallbackTotals(entries, bucket)
		if entryCount == 0 {
			entryCount = hitTotal
		}
	}
	row["query_total"] = queryTotal
	row["total"] = queryTotal
	row["hit_total"] = hitTotal
	row["hits"] = hitTotal
	row["stale_hit_total"] = staleHitTotal
	row["lazy_hit_total"] = staleHitTotal
	row["stale_hits"] = staleHitTotal
	row["miss_total"] = maxFloat64(0, queryTotal-hitTotal)
	row["misses"] = row["miss_total"]
	row["entries"] = entryCount
	row["size"] = entryCount
	row["entry_count"] = entryCount
	fillMosDNSCacheRates(row)
	return row
}

func mosDNSCacheFallbackTotals(entries []map[string]any, bucket string) (float64, float64, float64) {
	if bucket == "all" {
		cacheRows := mosDNSCacheRows(entries)
		return float64(len(entries)), float64(len(cacheRows)), 0
	}
	var total float64
	var hits float64
	for _, entry := range entries {
		if !mosDNSCacheEntryMatchesBucket(entry, bucket) {
			continue
		}
		total++
		if len(anySlice(entry["answers"])) > 0 || entryHasFakeIP(entry) {
			hits++
		}
	}
	return total, hits, 0
}

func mosDNSCacheEntryMatchesBucket(entry map[string]any, bucket string) bool {
	rule := strings.ToLower(stringMapValue(entry, "domain_set") + " " + stringMapValue(entry, "rule"))
	switch bucket {
	case "domestic":
		return strings.Contains(rule, "cn") || strings.Contains(rule, "realip") || strings.Contains(rule, "white") || strings.Contains(rule, "direct")
	case "foreign":
		return strings.Contains(rule, "no_cn") || strings.Contains(rule, "!cn") || strings.Contains(rule, "fakeip") || strings.Contains(rule, "google")
	case "node":
		return strings.Contains(rule, "node") || strings.Contains(rule, "nodenov")
	default:
		return true
	}
}

func fillMosDNSCacheRates(row map[string]any) {
	total := numericAny(row["query_total"])
	hits := numericAny(row["hit_total"])
	stale := firstNumberAny(row, "stale_hit_total", "lazy_hit_total", "stale_hits")
	if total > 0 {
		row["hit_rate"] = hits * 100 / total
		row["stale_hit_rate"] = stale * 100 / total
		row["lazy_hit_rate"] = stale * 100 / total
		return
	}
	if _, ok := row["hit_rate"]; !ok {
		row["hit_rate"] = 0.0
	}
	if _, ok := row["stale_hit_rate"]; !ok {
		row["stale_hit_rate"] = 0.0
	}
	if _, ok := row["lazy_hit_rate"]; !ok {
		row["lazy_hit_rate"] = 0.0
	}
}

func firstNumberAny(row map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if value, ok := row[key]; ok {
			return numericAny(value)
		}
	}
	return 0
}

func maxFloat64(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func mosDNSCacheSummaryFromRows(rows map[string]any) map[string]any {
	all, _ := rows["all"].(map[string]any)
	if len(all) == 0 {
		return map[string]any{"entries": 0, "size": 0, "hit_rate": 0, "query_total": 0, "hit_total": 0, "stale_hit_total": 0}
	}
	return map[string]any{
		"entries":         all["entries"],
		"size":            all["size"],
		"hit_rate":        all["hit_rate"],
		"stale_hit_rate":  all["stale_hit_rate"],
		"query_total":     all["query_total"],
		"hit_total":       all["hit_total"],
		"stale_hit_total": all["stale_hit_total"],
	}
}

func (a *App) mosDNSCacheDumpEntryCount(tag string) int {
	if tag == "" {
		return 0
	}
	rel := filepath.ToSlash(filepath.Join("configs/mosdns/cache", tag+".dump"))
	abs, err := a.safePath(rel)
	if err != nil {
		return 0
	}
	f, err := os.Open(abs)
	if err != nil {
		return 0
	}
	defer f.Close()
	gr, err := gzip.NewReader(f)
	if err != nil {
		return 0
	}
	defer gr.Close()
	if gr.Name != "mosdns_cache_v2" {
		return 0
	}
	var total int
	var header [8]byte
	for {
		if _, err := io.ReadFull(gr, header[:]); err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				break
			}
			return total
		}
		length := binary.BigEndian.Uint64(header[:])
		if length == 0 {
			continue
		}
		if length > 1<<20 {
			return total
		}
		block := make([]byte, int(length))
		if _, err := io.ReadFull(gr, block); err != nil {
			return total
		}
		total += countMosDNSCacheDumpBlockEntries(block)
	}
	return total
}

func (a *App) mosDNSCacheDumpDomains(tag string, limit int) []string {
	if tag == "" {
		return nil
	}
	rel := filepath.ToSlash(filepath.Join("configs/mosdns/cache", tag+".dump"))
	abs, err := a.safePath(rel)
	if err != nil {
		return nil
	}
	f, err := os.Open(abs)
	if err != nil {
		return nil
	}
	defer f.Close()
	gr, err := gzip.NewReader(f)
	if err != nil {
		return nil
	}
	defer gr.Close()
	if gr.Name != "mosdns_cache_v2" {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	var header [8]byte
	for {
		if _, err := io.ReadFull(gr, header[:]); err != nil {
			break
		}
		length := binary.BigEndian.Uint64(header[:])
		if length == 0 {
			continue
		}
		if length > 1<<20 {
			break
		}
		block := make([]byte, int(length))
		if _, err := io.ReadFull(gr, block); err != nil {
			break
		}
		for _, match := range cacheDomainRE.FindAll(block, -1) {
			domain := normalizeCacheDomainCandidate(string(match))
			if domain == "" || seen[domain] {
				continue
			}
			seen[domain] = true
			out = append(out, domain)
			if limit > 0 && len(out) >= limit {
				sort.Strings(out)
				return out
			}
		}
	}
	sort.Strings(out)
	return out
}

func normalizeCacheDomainCandidate(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.Trim(value, `"'[]{}(),;`)
	value = strings.TrimSuffix(value, ".")
	value = strings.TrimPrefix(value, "*.")
	if value == "" || strings.Contains(value, "..") || strings.Contains(value, "_") {
		return ""
	}
	if strings.HasPrefix(value, "in-addr.") || strings.HasSuffix(value, ".arpa") {
		return ""
	}
	parts := strings.Split(value, ".")
	if len(parts) < 2 {
		return ""
	}
	for _, part := range parts {
		if part == "" || len(part) > 63 {
			return ""
		}
	}
	return value
}

func dateOnly(value string) string {
	if value == "" {
		return ""
	}
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return t.Format("2006-01-02")
	}
	if len(value) >= 10 {
		return strings.ReplaceAll(value[:10], "/", "-")
	}
	return ""
}

func countMosDNSCacheDumpBlockEntries(block []byte) int {
	var count int
	for i := 0; i < len(block); {
		tag, n := readProtoVarint(block[i:])
		if n <= 0 {
			break
		}
		i += n
		field := tag >> 3
		wire := tag & 7
		switch wire {
		case 0:
			_, n = readProtoVarint(block[i:])
			if n <= 0 {
				return count
			}
			i += n
		case 1:
			i += 8
		case 2:
			length, n := readProtoVarint(block[i:])
			if n <= 0 {
				return count
			}
			i += n
			if length > uint64(len(block)-i) {
				return count
			}
			if field == 1 {
				count++
			}
			i += int(length)
		case 5:
			i += 4
		default:
			return count
		}
		if i < 0 || i > len(block) {
			return count
		}
	}
	return count
}

func readProtoVarint(data []byte) (uint64, int) {
	var value uint64
	for i, b := range data {
		if i == 10 {
			return 0, -1
		}
		value |= uint64(b&0x7f) << (uint(i) * 7)
		if b < 0x80 {
			return value, i + 1
		}
	}
	return 0, 0
}

func normalizeMapPayload(raw any) map[string]any {
	switch v := raw.(type) {
	case map[string]any:
		for _, key := range []string{"data", "result", "stats", "cache"} {
			if nested, ok := v[key].(map[string]any); ok {
				return nested
			}
		}
		return v
	default:
		return nil
	}
}

func firstNumeric(m map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		switch v := m[key].(type) {
		case float64:
			return v, true
		case int:
			return float64(v), true
		case int64:
			return float64(v), true
		case json.Number:
			n, err := v.Float64()
			return n, err == nil
		case string:
			n, err := strconv.ParseFloat(v, 64)
			if err == nil {
				return n, true
			}
		}
	}
	return 0, false
}

func (a *App) mosDNSClientIPSet() map[string]bool {
	rows, err := a.DB.Query(`select ip from mosdns_client_ips`)
	if err != nil {
		return map[string]bool{}
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var ip string
		if rows.Scan(&ip) == nil {
			out[ip] = true
		}
	}
	return out
}

func normalizeMosDNSClientProxyMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "white", "whitelist", "allow", "allowlist":
		return "white"
	case "black", "blacklist", "deny", "denylist", "block", "proxy", "proxy_default":
		return "black"
	default:
		return "off"
	}
}

func (a *App) mosDNSClientProxyMode() string {
	switches := a.mosDNSSwitchMap()
	switch {
	case switches["switch2"] && !switches["switch12"]:
		return "white"
	case !switches["switch2"] && switches["switch12"]:
		return "black"
	case !switches["switch2"] && !switches["switch12"]:
		return "off"
	default:
		return normalizeMosDNSClientProxyMode(a.setting("mosdns_client_proxy_mode", "off"))
	}
}

func (a *App) setMosDNSClientProxyMode(mode string) error {
	mode = normalizeMosDNSClientProxyMode(mode)
	now := time.Now()
	states := map[string]bool{
		"switch2":  mode == "white",
		"switch12": mode == "black",
	}
	for key, enabled := range states {
		_, _ = a.DB.Exec(`insert into mosdns_switch_states(switch_key,enabled,created_at,updated_at) values(?,?,?,?) on conflict(switch_key) do update set enabled=excluded.enabled,updated_at=excluded.updated_at`, key, enabled, now, now)
	}
	a.setSetting("mosdns_client_proxy_mode", mode)
	if err := a.rewriteMosDNSSwitchFile(); err != nil {
		return err
	}
	return a.applyMosDNSClientActiveStatus()
}

func (a *App) clientListStatusForCurrentMode() string {
	switch a.mosDNSClientProxyMode() {
	case "black":
		return "deny"
	case "white":
		return "allow"
	default:
		return "unscanned"
	}
}

func (a *App) applyMosDNSClientActiveStatus() error {
	now := time.Now()
	status := a.clientListStatusForCurrentMode()
	_, _ = a.DB.Exec(`update mosdns_clients set type='unscanned',updated_at=? where type in ('allow','deny')`, now)
	if status == "unscanned" {
		return nil
	}
	_, err := a.DB.Exec(`update mosdns_clients set type=?,updated_at=? where ip in (select ip from mosdns_client_ips)`, status, now)
	return err
}

func (a *App) syncMosDNSClientListed(idOrKey, status string) error {
	var ip, name string
	err := a.DB.QueryRow(`select ip,coalesce(custom_name,hostname,'') from mosdns_clients where id=? or ip=? or mac=? order by id desc limit 1`, idOrKey, idOrKey, idOrKey).Scan(&ip, &name)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	listed := status == "allow" || status == "deny"
	return a.setMosDNSClientIPAllowed(ip, listed, name)
}

func normalizeMosDNSClientStatus(status string, allowListed bool) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "allow", "allowed", "white", "whitelist", "client_ip", "proxy", "enabled":
		return "allow"
	case "deny", "denied", "black", "blacklist", "block":
		return "deny"
	case "disabled", "disable", "closed", "close", "off":
		return "disabled"
	case "unscanned", "unknown", "scan", "lan", "":
		if allowListed {
			return "allow"
		}
		return "unscanned"
	default:
		if allowListed {
			return "allow"
		}
		return "unscanned"
	}
}

func (a *App) setMosDNSClientIPAllowed(ip string, allowed bool, comment string) error {
	if strings.TrimSpace(ip) == "" {
		return nil
	}
	if allowed {
		_, err := a.DB.Exec(`insert into mosdns_client_ips(ip,comment,created_at,updated_at) values(?,?,?,?) on conflict(ip) do update set comment=excluded.comment,updated_at=excluded.updated_at`, ip, comment, time.Now(), time.Now())
		if err != nil {
			return err
		}
	} else {
		if _, err := a.DB.Exec(`delete from mosdns_client_ips where ip=?`, ip); err != nil {
			return err
		}
	}
	return a.rewriteMosDNSClientIPFile()
}

func (a *App) syncMosDNSClientAllowList(idOrKey, status string) error {
	var ip, name string
	err := a.DB.QueryRow(`select ip,coalesce(custom_name,hostname,'') from mosdns_clients where id=? or ip=? or mac=? order by id desc limit 1`, idOrKey, idOrKey, idOrKey).Scan(&ip, &name)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	return a.setMosDNSClientIPAllowed(ip, status == "allow", name)
}

func mosDNSRulePatternsFromRequest(patterns []string, items []struct {
	Pattern string `json:"pattern"`
	Content string `json:"content"`
	Name    string `json:"name"`
	Value   string `json:"value"`
}) []string {
	out := append([]string{}, patterns...)
	for _, item := range items {
		value := firstNonEmpty(item.Pattern, item.Content, item.Value, item.Name)
		if value != "" {
			out = append(out, value)
		}
	}
	return out
}

func (a *App) mosDNSLogCapacity() int {
	n, err := strconv.Atoi(a.setting("mosdns_log_capacity", "5000"))
	if err != nil || n <= 0 {
		return 5000
	}
	if n > 50000 {
		return 50000
	}
	return n
}

func filterLogLines(lines []string, r *http.Request) []string {
	level := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("level")))
	query := strings.ToLower(strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("q"), r.URL.Query().Get("keyword"), r.URL.Query().Get("search"))))
	if level == "" && query == "" {
		return lines
	}
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		lower := strings.ToLower(line)
		if level != "" && logLevelFromLine(line) != level {
			continue
		}
		if query != "" && !strings.Contains(lower, query) {
			continue
		}
		out = append(out, line)
	}
	return out
}

func structuredLogLines(lines []string) []map[string]any {
	out := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		if entry, ok := structuredJSONLogLine(line); ok {
			out = append(out, entry)
			continue
		}
		if entry, ok := structuredLogfmtLine(line); ok {
			out = append(out, entry)
			continue
		}
		timestamp, message := splitLeadingLogTime(line)
		if message == "" {
			message = strings.TrimSpace(line)
		}
		out = append(out, map[string]any{
			"time":    timestamp,
			"level":   logLevelFromLine(line),
			"message": message,
			"display": message,
			"raw":     line,
		})
	}
	return out
}

func structuredJSONLogLine(line string) (map[string]any, bool) {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "{") {
		return nil, false
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return nil, false
	}
	msg := stringMapValue(raw, "msg")
	caller := stringMapValue(raw, "caller")
	message := firstNonEmpty(
		stringMapValue(raw, "message"),
		stringMapValue(raw, "error"),
		stringMapValue(raw, "path"),
		stringMapValue(raw, "addr"),
		stringMapValue(raw, "endpoint"),
		stringMapValue(raw, "config"),
	)
	display := msg
	if caller != "" && msg != "" && message != "" {
		display = fmt.Sprintf("[%s] %s: %s", caller, msg, message)
	} else if caller != "" && msg != "" {
		display = fmt.Sprintf("[%s] %s", caller, msg)
	} else if message != "" {
		display = message
	}
	if display == "" {
		display = line
	}
	level := strings.ToLower(firstNonEmpty(stringMapValue(raw, "level"), "info"))
	return map[string]any{
		"time":    stringMapValue(raw, "time"),
		"level":   level,
		"message": display,
		"display": display,
		"caller":  caller,
		"msg":     msg,
		"raw":     line,
	}, true
}

func structuredLogfmtLine(line string) (map[string]any, bool) {
	line = strings.TrimSpace(line)
	if !strings.Contains(line, "=") {
		return nil, false
	}
	fields := map[string]string{}
	for _, match := range logfmtFieldRE.FindAllStringSubmatch(line, -1) {
		if len(match) < 3 {
			continue
		}
		value := match[2]
		if strings.HasPrefix(value, `"`) && strings.HasSuffix(value, `"`) {
			if unquoted, err := strconv.Unquote(value); err == nil {
				value = unquoted
			} else {
				value = strings.Trim(value, `"`)
			}
		}
		fields[match[1]] = value
	}
	if fields["time"] == "" && fields["level"] == "" && fields["msg"] == "" && fields["message"] == "" {
		return nil, false
	}
	message := firstNonEmpty(fields["msg"], fields["message"], fields["error"])
	if message == "" {
		message = line
	}
	return map[string]any{
		"time":    normalizeLogTime(fields["time"]),
		"level":   strings.ToLower(firstNonEmpty(fields["level"], "info")),
		"message": message,
		"display": message,
		"raw":     line,
	}, true
}

func displayLogLine(line string) string {
	if entry, ok := structuredJSONLogLine(line); ok {
		return fmtAny(entry["display"])
	}
	if entry, ok := structuredLogfmtLine(line); ok {
		return fmtAny(entry["display"])
	}
	_, message := splitLeadingLogTime(line)
	if message != "" {
		return message
	}
	return line
}

func mosDNSQueryRawLines(entries []map[string]any) []string {
	lines := make([]string, 0, len(entries))
	for _, entry := range entries {
		line := stringMapValue(entry, "raw")
		if line == "" || strings.HasPrefix(line, "map[") {
			line = fmt.Sprintf("time=%s client_ip=%s query_name=%s qtype=%s rule=%s rcode=%s",
				stringMapValue(entry, "query_time"),
				stringMapValue(entry, "client_ip"),
				stringMapValue(entry, "query_name"),
				stringMapValue(entry, "query_type"),
				stringMapValue(entry, "domain_set"),
				stringMapValue(entry, "response_code"),
			)
		}
		lines = append(lines, line)
	}
	return lines
}

func logLevelFromLine(line string) string {
	if entry, ok := structuredJSONLogLine(line); ok {
		return fmtAny(entry["level"])
	}
	if entry, ok := structuredLogfmtLine(line); ok {
		return fmtAny(entry["level"])
	}
	lower := strings.ToLower(line)
	switch {
	case strings.Contains(lower, "panic") || strings.Contains(lower, "fatal"):
		return "fatal"
	case strings.Contains(lower, "error") || strings.Contains(lower, "[err]"):
		return "error"
	case strings.Contains(lower, "warn"):
		return "warn"
	case strings.Contains(lower, "debug"):
		return "debug"
	default:
		return "info"
	}
}

func firstLogTime(line string) string {
	if entry, ok := structuredJSONLogLine(line); ok {
		return fmtAny(entry["time"])
	}
	if entry, ok := structuredLogfmtLine(line); ok {
		return fmtAny(entry["time"])
	}
	if timestamp, _ := splitLeadingLogTime(line); timestamp != "" {
		return timestamp
	}
	fields := strings.Fields(line)
	for _, field := range fields {
		field = strings.Trim(field, "[]")
		if _, err := time.Parse(time.RFC3339, field); err == nil {
			return field
		}
		if t, err := time.Parse("2006-01-02", field); err == nil {
			return t.Format(time.RFC3339)
		}
	}
	return ""
}

func splitLeadingLogTime(line string) (string, string) {
	line = strings.TrimSpace(line)
	if match := leadingRFC3339TimeRE.FindStringSubmatch(line); match != nil {
		rest := ""
		if len(match) > 2 {
			rest = strings.TrimSpace(match[2])
		}
		return normalizeLogTime(match[1]), rest
	}
	if match := leadingDateTimeRE.FindStringSubmatch(line); match != nil {
		rest := ""
		if len(match) > 3 {
			rest = strings.TrimSpace(match[3])
		}
		return strings.ReplaceAll(match[1], "/", "-") + " " + match[2], rest
	}
	return "", ""
}

func normalizeLogTime(value string) string {
	value = strings.TrimSpace(strings.Trim(value, "[]"))
	if value == "" {
		return ""
	}
	value = strings.ReplaceAll(value, "/", "-")
	return value
}

func (a *App) mosDNSRoutingState() map[string]any {
	state, ok := a.jsonSetting("mosdns_routing_task", defaultMosDNSRoutingState()).(map[string]any)
	if !ok {
		return defaultMosDNSRoutingState()
	}
	return state
}

func (a *App) generateMosDNSRoutingRules() (map[string]any, error) {
	state := defaultMosDNSRoutingState()
	state["running"] = true
	state["enabled"] = true
	state["status"] = "running"
	state["progress"] = 10
	a.storeJSONSetting("mosdns_routing_task", state)
	entries := a.mosDNSQueryDataset(10000)
	fakeSet := map[string]bool{}
	realSet := map[string]bool{}
	counts := map[string]int{}
	for _, entry := range entries {
		domain := stringMapValue(entry, "query_name")
		if domain == "" {
			continue
		}
		counts[domain]++
		if entryHasFakeIP(entry) {
			fakeSet[domain] = true
			continue
		}
		realSet[domain] = true
	}
	fakeDomains := sortedKeys(fakeSet)
	realDomains := sortedKeys(realSet)
	top := topDomainLines(counts, 200)
	files := map[string][]string{
		"fakeiprule.txt":  prefixedDomainLines(fakeDomains),
		"fakeiplist.txt":  fakeDomains,
		"realiprule.txt":  prefixedDomainLines(realDomains),
		"realiplist.txt":  realDomains,
		"top_domains.txt": top,
	}
	for name, lines := range files {
		rel := filepath.ToSlash(filepath.Join("configs/mosdns/gen", name))
		content := strings.Join(lines, "\n")
		if content != "" {
			content += "\n"
		}
		if err := a.writeTextFile(rel, content); err != nil {
			state["status"] = "failed"
			state["running"] = false
			state["error"] = err.Error()
			a.storeJSONSetting("mosdns_routing_task", state)
			return state, err
		}
	}
	state["running"] = false
	state["status"] = "completed"
	state["progress"] = 100
	state["last_run_at"] = time.Now().Format(time.RFC3339)
	state["fakeip_count"] = len(fakeDomains)
	state["realip_count"] = len(realDomains)
	state["rules"] = []map[string]any{
		{"name": "fakeiprule.txt", "count": len(fakeDomains), "path": "configs/mosdns/gen/fakeiprule.txt"},
		{"name": "realiprule.txt", "count": len(realDomains), "path": "configs/mosdns/gen/realiprule.txt"},
	}
	a.storeJSONSetting("mosdns_routing_task", state)
	return state, nil
}

func sortedKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func prefixedDomainLines(domains []string) []string {
	out := make([]string, 0, len(domains))
	for _, domain := range domains {
		if strings.Contains(domain, ":") {
			out = append(out, domain)
		} else {
			out = append(out, "domain:"+domain)
		}
	}
	return out
}

func topDomainLines(counts map[string]int, limit int) []string {
	type row struct {
		domain string
		count  int
	}
	rows := make([]row, 0, len(counts))
	for domain, count := range counts {
		rows = append(rows, row{domain: domain, count: count})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].count > rows[j].count })
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, fmt.Sprintf("%s %d", row.domain, row.count))
	}
	return out
}

func (a *App) storeJSONSetting(key string, value any) {
	b, err := json.Marshal(value)
	if err != nil {
		return
	}
	a.setSetting(key, string(b))
}

func (a *App) createConfigHistory(service, path, content, comment, username string) {
	if username == "" {
		username = "system"
	}
	now := nowString()
	_, _ = a.DB.Exec(`insert into config_histories(service,file_path,content,comment,is_stable,created_by,created_at,updated_at) values(?,?,?,?,?,?,?,?)`,
		service, path, content, comment, false, username, now, now)
}

func currentUsername(r *http.Request) string {
	if user := currentUser(r); user != nil {
		return user.Username
	}
	return "system"
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
