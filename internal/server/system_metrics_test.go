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
	app.mihomoTrafficAt = time.Now().Add(-mihomoTrafficCacheTTL - time.Second)

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
