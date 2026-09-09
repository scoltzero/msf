package server

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type cgroupCPUSource struct {
	statPath string
	capacity float64
}

func currentCgroupCPUSource() (cgroupCPUSource, bool) {
	dir, mountPoint, cgroupPath, ok := currentCgroupV2Dir()
	if !ok {
		return cgroupCPUSource{}, false
	}
	container := containerCPUContext(cgroupPath)
	if container {
		dir = mountPoint
	}
	capacity, constrained := cgroupCPUCapacity(dir, mountPoint)
	if !constrained && !container {
		return cgroupCPUSource{}, false
	}
	statPath := filepath.Join(dir, "cpu.stat")
	if _, err := readCgroupCPUUsage(statPath); err != nil {
		return cgroupCPUSource{}, false
	}
	return cgroupCPUSource{statPath: statPath, capacity: capacity}, true
}

func effectiveLinuxCPUCapacity() float64 {
	dir, mountPoint, cgroupPath, ok := currentCgroupV2Dir()
	if ok {
		if containerCPUContext(cgroupPath) {
			dir = mountPoint
		}
		capacity, constrained := cgroupCPUCapacity(dir, mountPoint)
		if constrained {
			return capacity
		}
	}
	return float64(max(runtime.NumCPU(), 1))
}

func currentCgroupV2Dir() (dir, mountPoint, cgroupPath string, ok bool) {
	cgroupData, err := os.ReadFile(filepath.Join(processProcRoot, "self", "cgroup"))
	if err != nil {
		return "", "", "", false
	}
	cgroupPath, ok = parseCgroupV2Path(string(cgroupData))
	if !ok {
		return "", "", "", false
	}
	mountData, err := os.ReadFile(filepath.Join(processProcRoot, "self", "mountinfo"))
	if err != nil {
		return "", "", "", false
	}
	dir, mountPoint, ok = resolveCgroupV2Dir(cgroupPath, string(mountData))
	return dir, mountPoint, cgroupPath, ok
}

func parseCgroupV2Path(text string) (string, bool) {
	for _, line := range strings.Split(text, "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), ":", 3)
		if len(parts) == 3 && parts[1] == "" && strings.HasPrefix(parts[2], "/") {
			return filepath.Clean(parts[2]), true
		}
	}
	return "", false
}

func resolveCgroupV2Dir(cgroupPath, mountInfo string) (dir, mountPoint string, ok bool) {
	cgroupPath = filepath.Clean(cgroupPath)
	for _, line := range strings.Split(mountInfo, "\n") {
		parts := strings.SplitN(line, " - ", 2)
		if len(parts) != 2 {
			continue
		}
		mountFields := strings.Fields(parts[0])
		fsFields := strings.Fields(parts[1])
		if len(mountFields) < 5 || len(fsFields) < 1 || fsFields[0] != "cgroup2" {
			continue
		}
		root := filepath.Clean(decodeMountInfoPath(mountFields[3]))
		mountPoint = filepath.Clean(decodeMountInfoPath(mountFields[4]))
		relative := ""
		switch {
		case cgroupPath == "/":
		case root == "/":
			relative = strings.TrimPrefix(cgroupPath, "/")
		case cgroupPath == root:
		case strings.HasPrefix(cgroupPath, root+"/"):
			relative = strings.TrimPrefix(cgroupPath, root+"/")
		case root != "/":
			// In a cgroup namespace, /proc/self/cgroup is relative to the
			// namespace root while mountinfo retains the mounted subtree root.
			relative = strings.TrimPrefix(cgroupPath, "/")
		default:
			continue
		}
		dir = filepath.Clean(filepath.Join(mountPoint, relative))
		if rel, err := filepath.Rel(mountPoint, dir); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		return dir, mountPoint, true
	}
	return "", "", false
}

func decodeMountInfoPath(value string) string {
	replacer := strings.NewReplacer(
		`\040`, " ",
		`\011`, "\t",
		`\012`, "\n",
		`\134`, `\`,
	)
	return replacer.Replace(value)
}

func cgroupCPUCapacity(dir, mountPoint string) (float64, bool) {
	capacity := float64(max(runtime.NumCPU(), 1))
	constrained := false
	if data, err := os.ReadFile(filepath.Join(dir, "cpuset.cpus.effective")); err == nil {
		if count, ok := countCPUSet(strings.TrimSpace(string(data))); ok && float64(count) < capacity {
			capacity = float64(count)
			constrained = true
		}
	}

	dir = filepath.Clean(dir)
	mountPoint = filepath.Clean(mountPoint)
	for current := dir; ; current = filepath.Dir(current) {
		if data, err := os.ReadFile(filepath.Join(current, "cpu.max")); err == nil {
			if quotaCapacity, limited, ok := parseCgroupCPUMax(string(data)); ok && limited {
				constrained = true
				if quotaCapacity < capacity {
					capacity = quotaCapacity
				}
			}
		}
		if current == mountPoint {
			break
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		if rel, err := filepath.Rel(mountPoint, parent); err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			break
		}
	}
	if capacity <= 0 {
		capacity = 1
	}
	return capacity, constrained
}

func parseCgroupCPUMax(text string) (capacity float64, limited, ok bool) {
	fields := strings.Fields(text)
	if len(fields) < 2 {
		return 0, false, false
	}
	period, err := strconv.ParseFloat(fields[1], 64)
	if err != nil || period <= 0 {
		return 0, false, false
	}
	if fields[0] == "max" {
		return 0, false, true
	}
	quota, err := strconv.ParseFloat(fields[0], 64)
	if err != nil || quota <= 0 {
		return 0, false, false
	}
	return quota / period, true, true
}

func countCPUSet(value string) (int, bool) {
	if value == "" {
		return 0, false
	}
	count := 0
	for _, item := range strings.Split(value, ",") {
		bounds := strings.SplitN(strings.TrimSpace(item), "-", 2)
		start, err := strconv.Atoi(bounds[0])
		if err != nil || start < 0 {
			return 0, false
		}
		end := start
		if len(bounds) == 2 {
			end, err = strconv.Atoi(bounds[1])
			if err != nil || end < start {
				return 0, false
			}
		}
		count += end - start + 1
	}
	return count, count > 0
}

func containerCPUContext(cgroupPath string) bool {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("MSF_RUNTIME")))
	if mode != "" {
		return mode == "docker" || mode == "container" || mode == "lxc" || mode == "podman" || mode == "kubernetes"
	}
	if IsDockerRuntime() || fileExists("/.containerenv") {
		return true
	}
	if data, err := os.ReadFile("/run/systemd/container"); err == nil && strings.TrimSpace(string(data)) != "" {
		return true
	}
	if data, err := os.ReadFile(filepath.Join(processProcRoot, "1", "environ")); err == nil {
		for _, entry := range strings.Split(string(data), "\x00") {
			if strings.HasPrefix(strings.ToLower(entry), "container=") {
				return true
			}
		}
	}
	path := strings.ToLower(cgroupPath)
	for _, marker := range []string{"docker", "containerd", "kubepods", "libpod", "podman", "lxc"} {
		if strings.Contains(path, marker) {
			return true
		}
	}
	return false
}

func readCgroupCPUUsage(path string) (uint64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return parseCgroupCPUUsage(string(b))
}

func parseCgroupCPUUsage(text string) (uint64, error) {
	for _, line := range strings.Split(text, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || fields[0] != "usage_usec" {
			continue
		}
		return strconv.ParseUint(fields[1], 10, 64)
	}
	return 0, os.ErrNotExist
}

func sampleCgroupCPUPercent(source cgroupCPUSource) (float64, bool) {
	before, err := readCgroupCPUUsage(source.statPath)
	if err != nil {
		return 0, false
	}
	started := time.Now()
	time.Sleep(linuxCPUSampleInterval)
	after, err := readCgroupCPUUsage(source.statPath)
	elapsed := time.Since(started)
	if err != nil {
		return 0, false
	}
	return cgroupCPUPercent(before, after, elapsed, source.capacity)
}

func cgroupCPUPercent(before, after uint64, elapsed time.Duration, capacity float64) (float64, bool) {
	if after < before || elapsed <= 0 || capacity <= 0 {
		return 0, false
	}
	usedSeconds := float64(after-before) / 1_000_000
	value := usedSeconds * 100 / elapsed.Seconds() / capacity
	return roundMetric(clampPercentFloat(value), 1), true
}
