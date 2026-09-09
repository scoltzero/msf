package server

import (
	"bufio"
	"context"
	"errors"
	"math"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type procMetrics struct {
	Uptime int64
	Memory int64
	CPU    float64
}

type cpuTimes struct {
	total uint64
	idle  uint64
}

const linuxClockTicks = 100

type linuxProcessStat struct {
	totalTicks uint64
	startTicks uint64
}

type linuxProcessCPUSample struct {
	at         time.Time
	totalTicks uint64
	startTicks uint64
	value      float64
}

var linuxProcessCPUCache = struct {
	sync.Mutex
	samples map[int]linuxProcessCPUSample
}{samples: map[int]linuxProcessCPUSample{}}

const linuxProcessCPUMinSampleInterval = 250 * time.Millisecond

func processResourceSnapshot(pid int) (procMetrics, bool) {
	if pid <= 0 {
		return procMetrics{}, false
	}
	if runtime.GOOS == "darwin" {
		return processResourceSnapshotDarwin(pid)
	}
	if runtime.GOOS != "linux" {
		return procMetrics{}, false
	}
	stat, err := readLinuxProcessStat(pid)
	if err != nil {
		return procMetrics{}, false
	}
	now := time.Now()
	elapsed := linuxProcessElapsedSeconds(stat.startTicks, now)
	// The first reading seeds the sampler. CPU is reported after a second
	// reading so it never depends on a potentially virtualized uptime clock.
	cpuPercent := sampleLinuxProcessCPU(pid, stat, now, 0)
	rss := readProcRSSBytes(pid)
	return procMetrics{Uptime: int64(elapsed), Memory: int64(rss), CPU: cpuPercent}, true
}

func readLinuxProcessStat(pid int) (linuxProcessStat, error) {
	b, err := os.ReadFile(filepath.Join(processProcRoot, strconv.Itoa(pid), "stat"))
	if err != nil {
		return linuxProcessStat{}, err
	}
	return parseLinuxProcessStat(string(b))
}

func parseLinuxProcessStat(text string) (linuxProcessStat, error) {
	end := strings.LastIndex(text, ")")
	if end < 0 || end+2 >= len(text) {
		return linuxProcessStat{}, errors.New("invalid process stat")
	}
	fields := strings.Fields(text[end+2:])
	if len(fields) < 20 {
		return linuxProcessStat{}, errors.New("incomplete process stat")
	}
	utime, err := strconv.ParseUint(fields[11], 10, 64)
	if err != nil {
		return linuxProcessStat{}, err
	}
	stime, err := strconv.ParseUint(fields[12], 10, 64)
	if err != nil {
		return linuxProcessStat{}, err
	}
	startTicks, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil {
		return linuxProcessStat{}, err
	}
	return linuxProcessStat{totalTicks: utime + stime, startTicks: startTicks}, nil
}

func sampleLinuxProcessCPU(pid int, current linuxProcessStat, now time.Time, fallback float64) float64 {
	linuxProcessCPUCache.Lock()
	defer linuxProcessCPUCache.Unlock()

	previous, ok := linuxProcessCPUCache.samples[pid]
	if !ok || previous.startTicks != current.startTicks || current.totalTicks < previous.totalTicks {
		linuxProcessCPUCache.samples[pid] = linuxProcessCPUSample{
			at: now, totalTicks: current.totalTicks, startTicks: current.startTicks, value: fallback,
		}
		pruneLinuxProcessCPUCache(now)
		return fallback
	}
	elapsed := now.Sub(previous.at)
	if elapsed < linuxProcessCPUMinSampleInterval {
		return previous.value
	}
	raw := float64(current.totalTicks-previous.totalTicks) / linuxClockTicks * 100 / elapsed.Seconds()
	value := roundMetric(normalizeProcessCPUPercent(raw), 1)
	linuxProcessCPUCache.samples[pid] = linuxProcessCPUSample{
		at: now, totalTicks: current.totalTicks, startTicks: current.startTicks, value: value,
	}
	return value
}

func pruneLinuxProcessCPUCache(now time.Time) {
	if len(linuxProcessCPUCache.samples) <= 64 {
		return
	}
	for pid, sample := range linuxProcessCPUCache.samples {
		if now.Sub(sample.at) > 10*time.Minute {
			delete(linuxProcessCPUCache.samples, pid)
		}
	}
}

func linuxProcessElapsedSeconds(startTicks uint64, now time.Time) float64 {
	if bootTime, ok := readLinuxBootTime(); ok {
		startedAt := bootTime.Add(time.Duration(startTicks) * time.Second / linuxClockTicks)
		if elapsed := now.Sub(startedAt).Seconds(); elapsed >= 0 {
			return elapsed
		}
	}
	uptime := readSystemUptimeSeconds()
	startSeconds := float64(startTicks) / linuxClockTicks
	if uptime >= startSeconds {
		return uptime - startSeconds
	}
	return 0
}

func readLinuxBootTime() (time.Time, bool) {
	b, err := os.ReadFile(filepath.Join(processProcRoot, "stat"))
	if err != nil {
		return time.Time{}, false
	}
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || fields[0] != "btime" {
			continue
		}
		seconds, err := strconv.ParseInt(fields[1], 10, 64)
		if err == nil && seconds > 0 {
			return time.Unix(seconds, 0), true
		}
	}
	return time.Time{}, false
}

func processResourceSnapshotDarwin(pid int) (procMetrics, bool) {
	out, err := commandOutput(2*time.Second, "/bin/ps", "-o", "etime=,rss=,%cpu=", "-p", strconv.Itoa(pid))
	if err != nil {
		return procMetrics{}, false
	}
	metrics, err := parseDarwinProcessMetrics(string(out))
	if err != nil {
		return procMetrics{}, false
	}
	return metrics, true
}

func parseDarwinProcessMetrics(text string) (procMetrics, error) {
	fields := strings.Fields(strings.TrimSpace(text))
	if len(fields) < 3 {
		return procMetrics{}, errors.New("incomplete ps metrics")
	}
	uptime, err := parseElapsedTime(fields[0])
	if err != nil {
		return procMetrics{}, err
	}
	rssKB, err := strconv.ParseUint(fields[1], 10, 64)
	if err != nil {
		return procMetrics{}, err
	}
	rawCPU, err := strconv.ParseFloat(strings.TrimSuffix(fields[2], "%"), 64)
	if err != nil {
		return procMetrics{}, err
	}
	return procMetrics{
		Uptime: int64(uptime),
		Memory: int64(rssKB * 1024),
		CPU:    roundMetric(normalizeProcessCPUPercent(rawCPU), 1),
	}, nil
}

func parseElapsedTime(value string) (float64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, errors.New("empty elapsed time")
	}
	var days float64
	if dayText, rest, ok := strings.Cut(value, "-"); ok {
		parsedDays, err := strconv.ParseFloat(dayText, 64)
		if err != nil {
			return 0, err
		}
		days = parsedDays
		value = rest
	}
	parts := strings.Split(value, ":")
	if len(parts) < 1 || len(parts) > 3 {
		return 0, errors.New("unsupported elapsed time")
	}
	values := make([]float64, len(parts))
	for i, part := range parts {
		parsed, err := strconv.ParseFloat(part, 64)
		if err != nil {
			return 0, err
		}
		values[i] = parsed
	}
	seconds := days * 24 * 60 * 60
	switch len(values) {
	case 1:
		seconds += values[0]
	case 2:
		seconds += values[0]*60 + values[1]
	case 3:
		seconds += values[0]*60*60 + values[1]*60 + values[2]
	}
	return seconds, nil
}

func normalizeProcessCPUPercent(raw float64) float64 {
	capacity := float64(max(runtime.NumCPU(), 1))
	if runtime.GOOS == "linux" {
		capacity = effectiveLinuxCPUCapacity()
	}
	return clampPercentFloat(raw / capacity)
}

func clampPercentFloat(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func roundMetric(value float64, precision int) float64 {
	factor := math.Pow10(precision)
	return math.Round(value*factor) / factor
}

func readProcRSSBytes(pid int) uint64 {
	file, err := os.Open(filepath.Join("/proc", strconv.Itoa(pid), "status"))
	if err != nil {
		return 0
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			value, _ := strconv.ParseUint(fields[1], 10, 64)
			return value * 1024
		}
	}
	return 0
}

func readSystemUptimeSeconds() float64 {
	if runtime.GOOS == "darwin" {
		out, err := commandOutput(time.Second, "/usr/sbin/sysctl", "-n", "kern.boottime")
		if err != nil {
			return 0
		}
		return parseDarwinSystemUptime(string(out), time.Now())
	}
	b, err := os.ReadFile(filepath.Join(processProcRoot, "uptime"))
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(b))
	if len(fields) == 0 {
		return 0
	}
	value, _ := strconv.ParseFloat(fields[0], 64)
	return value
}

var darwinBootSecondsRE = regexp.MustCompile(`\bsec\s*=\s*([0-9]+)`)

func parseDarwinSystemUptime(text string, now time.Time) float64 {
	match := darwinBootSecondsRE.FindStringSubmatch(text)
	if len(match) != 2 {
		return 0
	}
	bootSeconds, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil || bootSeconds <= 0 {
		return 0
	}
	uptime := now.Sub(time.Unix(bootSeconds, 0)).Seconds()
	if uptime < 0 {
		return 0
	}
	return uptime
}

func readCPUTimes() (cpuTimes, error) {
	b, err := os.ReadFile(filepath.Join(processProcRoot, "stat"))
	if err != nil {
		return cpuTimes{}, err
	}
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[0] != "cpu" {
			continue
		}
		var total uint64
		for _, field := range fields[1:] {
			value, _ := strconv.ParseUint(field, 10, 64)
			total += value
		}
		idle, _ := strconv.ParseUint(fields[4], 10, 64)
		if len(fields) > 5 {
			iowait, _ := strconv.ParseUint(fields[5], 10, 64)
			idle += iowait
		}
		return cpuTimes{total: total, idle: idle}, nil
	}
	return cpuTimes{}, errors.New("cpu line not found")
}

const linuxCPUSampleInterval = 120 * time.Millisecond

func sampleCPUPercent() float64 {
	if runtime.GOOS == "darwin" {
		return sampleDarwinCPUPercent()
	}
	if runtime.GOOS != "linux" {
		return 0
	}
	if source, ok := currentCgroupCPUSource(); ok {
		if value, sampled := sampleCgroupCPUPercent(source); sampled {
			return value
		}
	}
	a, err := readCPUTimes()
	if err != nil {
		return 0
	}
	time.Sleep(linuxCPUSampleInterval)
	b, err := readCPUTimes()
	if err != nil || b.total <= a.total {
		return 0
	}
	total := b.total - a.total
	idle := b.idle - a.idle
	if total == 0 || idle > total {
		return 0
	}
	return clampPercentFloat(float64(total-idle) * 100 / float64(total))
}

var darwinCPUUsageCache = struct {
	sync.Mutex
	at    time.Time
	value float64
}{}

const darwinCPUUsageCacheTTL = time.Second

func sampleDarwinCPUPercent() float64 {
	darwinCPUUsageCache.Lock()
	defer darwinCPUUsageCache.Unlock()
	if !darwinCPUUsageCache.at.IsZero() && time.Since(darwinCPUUsageCache.at) < darwinCPUUsageCacheTTL {
		return darwinCPUUsageCache.value
	}
	out, err := commandOutput(2*time.Second, "/usr/bin/top", "-l", "1", "-n", "0", "-s", "0")
	if err != nil {
		return darwinCPUUsageCache.value
	}
	value, err := parseDarwinCPUPercent(string(out))
	if err != nil {
		return darwinCPUUsageCache.value
	}
	darwinCPUUsageCache.at = time.Now()
	darwinCPUUsageCache.value = roundMetric(value, 1)
	return darwinCPUUsageCache.value
}

var darwinCPUIdleRE = regexp.MustCompile(`(?im)^CPU usage:.*?([0-9]+(?:\.[0-9]+)?)%\s+idle\s*$`)

func parseDarwinCPUPercent(text string) (float64, error) {
	matches := darwinCPUIdleRE.FindAllStringSubmatch(text, -1)
	if len(matches) == 0 {
		return 0, errors.New("cpu usage line not found")
	}
	idle, err := strconv.ParseFloat(matches[len(matches)-1][1], 64)
	if err != nil {
		return 0, err
	}
	return clampPercentFloat(100 - idle), nil
}

func readNetworkCounters() []map[string]any {
	if runtime.GOOS == "darwin" {
		out, err := commandOutput(2*time.Second, "/usr/sbin/netstat", "-ibn")
		if err != nil {
			return nil
		}
		return parseDarwinNetworkCounters(string(out))
	}
	b, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil
	}
	var rows []map[string]any
	for _, line := range strings.Split(string(b), "\n") {
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		name := strings.TrimSpace(parts[0])
		fields := strings.Fields(parts[1])
		if name == "" || len(fields) < 16 {
			continue
		}
		rx, _ := strconv.ParseUint(fields[0], 10, 64)
		tx, _ := strconv.ParseUint(fields[8], 10, 64)
		rows = append(rows, map[string]any{"name": name, "rx_bytes": rx, "tx_bytes": tx})
	}
	return rows
}

func parseDarwinNetworkCounters(text string) []map[string]any {
	lines := strings.Split(text, "\n")
	nameIndex, networkIndex, inBytesIndex, outBytesIndex := -1, -1, -1, -1
	rows := []map[string]any{}
	seen := map[string]bool{}
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if fields[0] == "Name" {
			for index, field := range fields {
				switch field {
				case "Name":
					nameIndex = index
				case "Network":
					networkIndex = index
				case "Ibytes":
					inBytesIndex = index
				case "Obytes":
					outBytesIndex = index
				}
			}
			continue
		}
		maxIndex := nameIndex
		for _, index := range []int{networkIndex, inBytesIndex, outBytesIndex} {
			if index > maxIndex {
				maxIndex = index
			}
		}
		if nameIndex < 0 || networkIndex < 0 || inBytesIndex < 0 || outBytesIndex < 0 || len(fields) <= maxIndex {
			continue
		}
		if !strings.HasPrefix(fields[networkIndex], "<Link#") {
			continue
		}
		name := strings.TrimSuffix(fields[nameIndex], "*")
		if name == "" || seen[name] {
			continue
		}
		rx, rxErr := strconv.ParseUint(fields[inBytesIndex], 10, 64)
		tx, txErr := strconv.ParseUint(fields[outBytesIndex], 10, 64)
		if rxErr != nil || txErr != nil {
			continue
		}
		seen[name] = true
		rows = append(rows, map[string]any{"name": name, "rx_bytes": rx, "tx_bytes": tx})
	}
	return rows
}

func readDarwinMemInfo() map[string]uint64 {
	out := map[string]uint64{"MemTotal": 0, "MemAvailable": 0}
	totalRaw, err := commandOutput(time.Second, "/usr/sbin/sysctl", "-n", "hw.memsize")
	if err != nil {
		return out
	}
	total, err := strconv.ParseUint(strings.TrimSpace(string(totalRaw)), 10, 64)
	if err != nil {
		return out
	}
	vmRaw, err := commandOutput(time.Second, "/usr/bin/vm_stat")
	if err != nil {
		out["MemTotal"] = total
		return out
	}
	available := parseDarwinAvailableMemory(string(vmRaw))
	if available > total {
		available = total
	}
	out["MemTotal"] = total
	out["MemAvailable"] = available
	return out
}

var darwinVMPageSizeRE = regexp.MustCompile(`page size of\s+([0-9]+)\s+bytes`)

func parseDarwinAvailableMemory(text string) uint64 {
	pageSize := uint64(4096)
	if match := darwinVMPageSizeRE.FindStringSubmatch(text); len(match) == 2 {
		if parsed, err := strconv.ParseUint(match[1], 10, 64); err == nil && parsed > 0 {
			pageSize = parsed
		}
	}
	reclaimableKeys := map[string]bool{
		"Pages free":        true,
		"Pages inactive":    true,
		"Pages speculative": true,
		"Pages purgeable":   true,
	}
	var pages uint64
	for _, line := range strings.Split(text, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok || !reclaimableKeys[strings.TrimSpace(key)] {
			continue
		}
		value = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(value), "."))
		parsed, err := strconv.ParseUint(value, 10, 64)
		if err == nil {
			pages += parsed
		}
	}
	return pages * pageSize
}

func commandOutput(timeout time.Duration, path string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Env = append(os.Environ(), "LC_ALL=C", "LANG=C")
	return cmd.Output()
}

func diskUsage(path string) map[string]any {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	used := total - free
	return map[string]any{"ok": true, "total": total, "free": free, "used": used, "percent": percent(used, total)}
}

func tcpPortOpen(port int) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), 150*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
