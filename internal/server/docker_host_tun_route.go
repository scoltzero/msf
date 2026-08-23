package server

import (
	"context"
	"fmt"
	"log"
	"net/netip"
	"os/exec"
	"strings"
	"time"
)

const (
	dockerHostTunInterface      = "mihomo"
	dockerHostTunCommandTimeout = 8 * time.Second
	dockerHostTunIPv4RouteKey   = "docker.host_tun.fake_ipv4_route"
	dockerHostTunIPv6RouteKey   = "docker.host_tun.fake_ipv6_route"
)

var (
	dockerHostTunRouteWait  = 5 * time.Second
	dockerHostTunRouteRetry = 250 * time.Millisecond
	dockerHostTunCommand    = func(ctx context.Context, name string, args ...string) ([]byte, error) {
		return exec.CommandContext(ctx, name, args...).CombinedOutput()
	}
)

func (a *App) afterServiceStart(name string) {
	if normalizeServiceName(strings.ToLower(strings.TrimSpace(name))) != "mihomo" {
		return
	}
	go a.applyDockerHostTunRouteFix()
}

func (a *App) applyDockerHostTunRouteFix() {
	a.applyDockerHostTunRouteFixWithWait(dockerHostTunRouteWait)
}

func (a *App) applyDockerHostTunRouteFixWithWait(wait time.Duration) {
	if !a.shouldApplyDockerHostTunRouteFix() {
		return
	}
	cfg, ok := a.latestSetupConfig()
	if !ok {
		return
	}
	cfg.defaults()

	ctx, cancel := context.WithTimeout(context.Background(), dockerHostTunCommandTimeout+wait)
	defer cancel()

	if !waitForDockerHostTunInterface(ctx, wait) {
		log.Printf("warning: docker host-tun route fix skipped: interface %s is not ready; see docs/docker.md for manual fallback", dockerHostTunInterface)
		return
	}

	a.reconcileDockerHostTunRoute(ctx, false, fakeIPv4RouteCIDR(cfg.FakeIPRangeV4), true)
	if cfg.EnableIPv6 {
		cidr, ok := strictFakeIPv6RouteCIDR(cfg.FakeIPRangeV6)
		if !ok {
			log.Printf("warning: docker host-tun route fix skipped IPv6 route: invalid fake-ip IPv6 range %q", cfg.FakeIPRangeV6)
		} else {
			a.reconcileDockerHostTunRoute(ctx, true, cidr, true)
		}
	} else {
		cidr, _ := strictFakeIPv6RouteCIDR(cfg.FakeIPRangeV6)
		a.reconcileDockerHostTunRoute(ctx, true, cidr, false)
	}

	iface, err := dockerHostTunDefaultInterface(ctx)
	if err != nil {
		log.Printf("warning: docker host-tun route fix could not detect default interface for rp_filter: %v", err)
		return
	}
	if iface == "" {
		log.Print("warning: docker host-tun route fix skipped rp_filter update: default interface not found")
		return
	}
	path := fmt.Sprintf("/proc/sys/net/ipv4/conf/%s/rp_filter", iface)
	if out, err := dockerHostTunCommand(ctx, "sh", "-c", `printf 0 > "$1"`, "sh", path); err != nil {
		log.Printf("warning: docker host-tun route fix could not disable rp_filter on %s: %v: %s", iface, err, strings.TrimSpace(string(out)))
	}
}

func (a *App) shouldApplyDockerHostTunRouteFix() bool {
	if !IsDockerRuntime() || DockerNetworkMode() != "host-tun" {
		return false
	}
	cfg, ok := a.latestSetupConfig()
	if !ok {
		return false
	}
	cfg.defaults()
	return strings.EqualFold(cfg.ProxyCore, "mihomo") && isTUNProxyMode(cfg.LinuxProxyMode)
}

func (a *App) reconcileDockerHostTunRoute(ctx context.Context, ipv6 bool, cidr string, enabled bool) {
	key := dockerHostTunIPv4RouteKey
	familyArgs := []string{}
	if ipv6 {
		key = dockerHostTunIPv6RouteKey
		familyArgs = []string{"-6"}
	}
	previous := strings.TrimSpace(a.setting(key, ""))
	for _, stale := range uniqueStrings([]string{previous, cidr}) {
		if enabled && stale == cidr {
			continue
		}
		args := append(append([]string{}, familyArgs...), "route", "del", stale, "dev", dockerHostTunInterface)
		_, _ = dockerHostTunCommand(ctx, "ip", args...)
	}
	if !enabled {
		a.setSetting(key, "")
		return
	}
	src, ok := fakeIPRouteSource(cidr)
	if !ok {
		log.Printf("warning: docker host-tun route fix skipped route: invalid fake-ip range %q", cidr)
		return
	}
	args := append(append([]string{}, familyArgs...), "route", "replace", cidr, "dev", dockerHostTunInterface, "src", src)
	if out, err := dockerHostTunCommand(ctx, "ip", args...); err != nil {
		log.Printf("warning: docker host-tun route fix failed to replace FakeIP route: %v: %s", err, strings.TrimSpace(string(out)))
		return
	}
	a.setSetting(key, cidr)
}

func waitForDockerHostTunInterface(ctx context.Context, wait time.Duration) bool {
	deadline := time.Now().Add(wait)
	for {
		if _, err := dockerHostTunCommand(ctx, "ip", "link", "show", dockerHostTunInterface); err == nil {
			return true
		}
		if wait <= 0 || time.Now().After(deadline) {
			return false
		}
		select {
		case <-ctx.Done():
			return false
		case <-time.After(dockerHostTunRouteRetry):
		}
	}
}

func dockerHostTunDefaultInterface(ctx context.Context) (string, error) {
	out, err := dockerHostTunCommand(ctx, "ip", "-4", "route", "show", "default")
	if err != nil {
		return "", err
	}
	return parseDockerHostTunDefaultInterface(string(out)), nil
}

func parseDockerHostTunDefaultInterface(output string) string {
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		for i, field := range fields {
			if field == "dev" && i+1 < len(fields) {
				return fields[i+1]
			}
		}
	}
	return ""
}

func strictFakeIPv6RouteCIDR(v string) (string, bool) {
	v = strings.TrimSpace(v)
	if v == "" {
		v = defaultFakeIPv6Prefix
	}
	if p, err := netip.ParsePrefix(v); err == nil && p.Addr().Is6() {
		return p.Masked().String(), true
	}
	if addr, err := netip.ParseAddr(v); err == nil && addr.Is6() {
		return netip.PrefixFrom(addr, 64).Masked().String(), true
	}
	return "", false
}

func fakeIPRouteSource(cidr string) (string, bool) {
	prefix, err := netip.ParsePrefix(strings.TrimSpace(cidr))
	if err != nil {
		return "", false
	}
	addr := prefix.Masked().Addr()
	src := addr.Next()
	if !src.IsValid() || !prefix.Contains(src) {
		return "", false
	}
	return src.String(), true
}
