package server

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"testing"
	"time"
)

func TestParseDarwinSystemMetrics(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	uptime := parseDarwinSystemUptime("{ sec = 1799996400, usec = 123456 }", now)
	if uptime != 3600 {
		t.Fatalf("unexpected uptime: %v", uptime)
	}

	cpu, err := parseDarwinCPUPercent("CPU usage: 7.23% user, 11.97% sys, 80.79% idle\n")
	if err != nil || math.Abs(cpu-19.21) > 0.001 {
		t.Fatalf("unexpected cpu parse: cpu=%v err=%v", cpu, err)
	}

	available := parseDarwinAvailableMemory(`Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                1000.
Pages active:                              900.
Pages inactive:                           2000.
Pages speculative:                         300.
Pages purgeable:                           400.
Pages occupied by compressor:              800.
`)
	if want := uint64(3700 * 16384); available != want {
		t.Fatalf("unexpected available memory: got=%d want=%d", available, want)
	}
}

func TestParseDarwinNetworkCountersUsesLinkRowsOnce(t *testing.T) {
	rows := parseDarwinNetworkCounters(`Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                       10     0       1000       10     0       2000     0
lo0        16384 127           127.0.0.1        10     -       1000       10     -       2000     -
en0        1500  <Link#7>    aa:bb:cc:dd:ee:ff  20     0       3000       30     0       4000     0
en0        1500  192.168.1    192.168.1.10      20     -       3000       30     -       4000     -
gif0*      1280  <Link#2>                       0      0       0          0      0       0        0
`)
	if len(rows) != 3 {
		t.Fatalf("expected three unique link rows, got %#v", rows)
	}
	if stringMapValue(rows[1], "name") != "en0" || uint64FromAny(rows[1]["rx_bytes"]) != 3000 || uint64FromAny(rows[1]["tx_bytes"]) != 4000 {
		t.Fatalf("unexpected en0 counters: %#v", rows[1])
	}
	if stringMapValue(rows[2], "name") != "gif0" {
		t.Fatalf("interface marker should be removed: %#v", rows[2])
	}
}

func TestParseDarwinProcessMetrics(t *testing.T) {
	metrics, err := parseDarwinProcessMetrics("2-03:04:05 4096 42.0\n")
	if err != nil {
		t.Fatal(err)
	}
	if metrics.Uptime != 2*86400+3*3600+4*60+5 {
		t.Fatalf("unexpected process uptime: %d", metrics.Uptime)
	}
	if metrics.Memory != 4096*1024 {
		t.Fatalf("unexpected RSS bytes: %d", metrics.Memory)
	}
	wantCPU := roundMetric(normalizeProcessCPUPercent(42), 1)
	if metrics.CPU != wantCPU {
		t.Fatalf("unexpected process cpu: got=%v want=%v", metrics.CPU, wantCPU)
	}
}

func TestParseLinuxProcessStatHandlesParenthesesInName(t *testing.T) {
	stat, err := parseLinuxProcessStat("123 (worker name)) S 1 2 3 4 5 6 7 8 9 10 120 30 14 15 16 17 18 19 123450")
	if err != nil {
		t.Fatal(err)
	}
	if stat.totalTicks != 150 || stat.startTicks != 123450 {
		t.Fatalf("unexpected process stat: %#v", stat)
	}
}

func TestLinuxProcessCPUUsesDeltasAndKeepsNearConcurrentValue(t *testing.T) {
	pid := 9_876_543
	linuxProcessCPUCache.Lock()
	delete(linuxProcessCPUCache.samples, pid)
	linuxProcessCPUCache.Unlock()
	t.Cleanup(func() {
		linuxProcessCPUCache.Lock()
		delete(linuxProcessCPUCache.samples, pid)
		linuxProcessCPUCache.Unlock()
	})

	started := time.Unix(1_800_000_000, 0)
	first := linuxProcessStat{totalTicks: 100, startTicks: 50}
	if got := sampleLinuxProcessCPU(pid, first, started, 3.5); got != 3.5 {
		t.Fatalf("first sample should use fallback: %v", got)
	}
	second := linuxProcessStat{totalTicks: 150, startTicks: 50}
	want := roundMetric(normalizeProcessCPUPercent(50), 1)
	if got := sampleLinuxProcessCPU(pid, second, started.Add(time.Second), 0); got != want {
		t.Fatalf("delta sample=%v want=%v", got, want)
	}
	if got := sampleLinuxProcessCPU(pid, second, started.Add(time.Second+time.Millisecond), 0); got != want {
		t.Fatalf("near-concurrent read should keep last value: %v", got)
	}
	if got := sampleLinuxProcessCPU(pid, linuxProcessStat{totalTicks: 1, startTicks: 99}, started.Add(2*time.Second), 2.5); got != 2.5 {
		t.Fatalf("PID reuse should reset the sampler: %v", got)
	}
}

func TestCgroupV2PathAndMountResolution(t *testing.T) {
	cgroupPath, ok := parseCgroupV2Path("0::/lxc/101\n")
	if !ok || cgroupPath != "/lxc/101" {
		t.Fatalf("unexpected cgroup path: %q ok=%v", cgroupPath, ok)
	}
	mountInfo := "36 25 0:32 / /sys/fs/cgroup rw,nosuid,nodev,noexec,relatime - cgroup2 cgroup rw\n"
	dir, mountPoint, ok := resolveCgroupV2Dir(cgroupPath, mountInfo)
	if !ok || dir != "/sys/fs/cgroup/lxc/101" || mountPoint != "/sys/fs/cgroup" {
		t.Fatalf("unexpected cgroup mount resolution: dir=%q mount=%q ok=%v", dir, mountPoint, ok)
	}

	namespacedMount := "36 25 0:32 /lxc/101 /sys/fs/cgroup rw,nosuid,nodev,noexec,relatime - cgroup2 cgroup rw\n"
	dir, mountPoint, ok = resolveCgroupV2Dir("/", namespacedMount)
	if !ok || dir != "/sys/fs/cgroup" || mountPoint != "/sys/fs/cgroup" {
		t.Fatalf("unexpected namespaced cgroup mount: dir=%q mount=%q ok=%v", dir, mountPoint, ok)
	}
	dir, mountPoint, ok = resolveCgroupV2Dir("/system.slice/msf.service", namespacedMount)
	if !ok || dir != "/sys/fs/cgroup/system.slice/msf.service" || mountPoint != "/sys/fs/cgroup" {
		t.Fatalf("unexpected namespaced child cgroup mount: dir=%q mount=%q ok=%v", dir, mountPoint, ok)
	}
}

func TestParseCgroupCPUCapacityInputs(t *testing.T) {
	capacity, limited, ok := parseCgroupCPUMax("200000 100000\n")
	if !ok || !limited || capacity != 2 {
		t.Fatalf("unexpected cpu.max parse: capacity=%v limited=%v ok=%v", capacity, limited, ok)
	}
	if _, limited, ok = parseCgroupCPUMax("max 100000\n"); !ok || limited {
		t.Fatalf("unlimited cpu.max parse: limited=%v ok=%v", limited, ok)
	}
	if count, ok := countCPUSet("0-1,4,6-7"); !ok || count != 5 {
		t.Fatalf("unexpected cpuset parse: count=%d ok=%v", count, ok)
	}
	if usage, err := parseCgroupCPUUsage("usage_usec 123456\nuser_usec 100000\nsystem_usec 23456\n"); err != nil || usage != 123456 {
		t.Fatalf("unexpected cpu.stat parse: usage=%d err=%v", usage, err)
	}
	if percent, ok := cgroupCPUPercent(1_000_000, 2_000_000, time.Second, 2); !ok || percent != 50 {
		t.Fatalf("two-core cgroup should report one busy core as 50%%: percent=%v ok=%v", percent, ok)
	}
}

func TestDarwinCollectorsReturnLiveValues(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Darwin collector integration test")
	}
	if uptime := readSystemUptimeSeconds(); uptime <= 0 {
		t.Fatalf("system uptime should be positive, got %v", uptime)
	}
	mem := readMemInfo()
	if mem["MemTotal"] == 0 || mem["MemAvailable"] == 0 || mem["MemAvailable"] > mem["MemTotal"] {
		t.Fatalf("unexpected memory snapshot: %#v", mem)
	}
	if rows := readNetworkCounters(); len(rows) == 0 {
		t.Fatal("network counters should not be empty")
	}
	if metrics, ok := processResourceSnapshot(os.Getpid()); !ok || metrics.Memory <= 0 {
		t.Fatalf("current process metrics unavailable: ok=%v metrics=%#v", ok, metrics)
	}
	if model := cpuModel(); model == "" || model == runtime.GOARCH {
		t.Fatalf("expected Darwin CPU model, got %q", model)
	}
}

func TestMonitorHistoryUsesNormalizedNetworkObject(t *testing.T) {
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/connections" {
			writeJSON(w, http.StatusOK, map[string]any{"connections": []any{}, "downloadTotal": 0, "uploadTotal": 0})
			return
		}
		http.NotFound(w, r)
	}))
	defer controller.Close()

	app := newTestApp(t)
	app.setSetting("mihomo_controller_endpoint", controller.URL)
	token := tokenForRole(t, app, "admin")
	res := requestJSON(t, app, http.MethodGet, "/api/v1/monitor/history", token, nil)
	if res.Code != http.StatusOK {
		t.Fatalf("history status=%d body=%s", res.Code, res.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	points := anySlice(body["data"])
	if len(points) != 1 {
		t.Fatalf("unexpected history points: %#v", body)
	}
	point, _ := points[0].(map[string]any)
	if _, ok := point["network"].(map[string]any); !ok {
		t.Fatalf("network history must be an object: %#v", point["network"])
	}
	for _, key := range []string{"download_speed", "upload_speed", "connections", "connection_count"} {
		if _, ok := point[key]; !ok {
			t.Fatalf("history point missing %s: %#v", key, point)
		}
	}
}

func TestMonitorNetworkNearConcurrentCallKeepsCachedRate(t *testing.T) {
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"connections": []any{}, "downloadTotal": 0, "uploadTotal": 0})
	}))
	defer controller.Close()

	app := newTestApp(t)
	app.setSetting("mihomo_controller_endpoint", controller.URL)
	now := time.Now()
	app.monitorNetworkLast = monitorNetworkSample{At: now, RXBytes: 1, TXBytes: 1}
	app.monitorNetworkCache = map[string]any{
		"download_speed": float64(1234),
		"upload_speed":   float64(567),
		"down_speed":     float64(1234),
		"up_speed":       float64(567),
		"downloadSpeed":  float64(1234),
		"uploadSpeed":    float64(567),
	}
	got := app.monitorNetworkSnapshot(now.Add(100 * time.Millisecond))
	if numericMapValue(got, "download_speed") != 1234 || numericMapValue(got, "upload_speed") != 567 {
		t.Fatalf("near-concurrent poll should keep cached rates: %#v", got)
	}
}

func TestMihomoTrafficCacheReturnsStaleValueWhileRefreshing(t *testing.T) {
	controller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/traffic" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"up": 900, "down": 1200})
	}))
	defer controller.Close()

	app := newTestApp(t)
	app.setSetting("mihomo_controller_endpoint", controller.URL)
	app.mihomoTrafficCache = map[string]any{"up": float64(90), "down": float64(120), "upload": float64(90), "download": float64(120)}
	// The menu bar polls once per second, so a 1.5-second-old sample must refresh.
	app.mihomoTrafficAt = time.Now().Add(-1500 * time.Millisecond)

	got := app.mihomoTrafficCachedPayload()
	if numericMapValue(got, "up") != 90 || numericMapValue(got, "down") != 120 {
		t.Fatalf("expired cache should remain visible during refresh: %#v", got)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if refreshed, ok := app.cachedMihomoTraffic(); ok && numericMapValue(refreshed, "up") == 900 && numericMapValue(refreshed, "down") == 1200 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("traffic cache did not refresh")
}

func TestMihomoTrafficDerivesRateFromConnectionTotals(t *testing.T) {
	app := newTestApp(t)
	now := time.Now()
	app.mihomoTrafficTotalsLast = mihomoTrafficTotalsSample{
		At:            now,
		DownloadTotal: 1000,
		UploadTotal:   500,
		DownloadRate:  25,
		UploadRate:    10,
	}

	got := app.deriveMihomoTrafficFromTotals(1600, 800, now.Add(2*time.Second))
	if numericMapValue(got, "down") != 300 || numericMapValue(got, "up") != 150 {
		t.Fatalf("unexpected derived rate: %#v", got)
	}

	nearConcurrent := app.deriveMihomoTrafficFromTotals(1610, 805, now.Add(2100*time.Millisecond))
	if numericMapValue(nearConcurrent, "down") != 300 || numericMapValue(nearConcurrent, "up") != 150 {
		t.Fatalf("near-concurrent overview should keep the last rate: %#v", nearConcurrent)
	}
}
