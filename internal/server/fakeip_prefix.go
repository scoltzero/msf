package server

import (
	"fmt"
	"net/netip"
	"strings"
)

const (
	defaultFakeIPv4Prefix = "28.0.0.0/8"
	defaultFakeIPv6Prefix = "f2b0::/18"
)

var forbiddenFakeIPv4Prefixes = mustPrefixes(
	"0.0.0.0/8",
	"10.0.0.0/8",
	"100.64.0.0/10",
	"127.0.0.0/8",
	"169.254.0.0/16",
	"172.16.0.0/12",
	"192.0.0.0/24",
	"192.0.2.0/24",
	"192.168.0.0/16",
	"198.18.0.0/15",
	"198.51.100.0/24",
	"203.0.113.0/24",
	"224.0.0.0/4",
	"240.0.0.0/4",
)

var forbiddenFakeIPv6Prefixes = mustPrefixes(
	"::/128",
	"::1/128",
	"fe80::/10",
	"ff00::/8",
)

func mustPrefixes(values ...string) []netip.Prefix {
	out := make([]netip.Prefix, 0, len(values))
	for _, value := range values {
		out = append(out, netip.MustParsePrefix(value))
	}
	return out
}

func normalizeFakeIPPrefixes(cfg *SetupConfig) error {
	v4, err := normalizeFakeIPPrefix(cfg.FakeIPRangeV4, false)
	if err != nil {
		return fmt.Errorf("fake_ip_range_v4: %w", err)
	}
	v6, err := normalizeFakeIPPrefix(cfg.FakeIPRangeV6, true)
	if err != nil {
		return fmt.Errorf("fake_ip_range_v6: %w", err)
	}
	cfg.FakeIPRangeV4 = v4
	cfg.FakeIPRangeV6 = v6
	return nil
}

func normalizeFakeIPPrefix(value string, ipv6 bool) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		if ipv6 {
			value = defaultFakeIPv6Prefix
		} else {
			value = defaultFakeIPv4Prefix
		}
	}
	prefix, err := netip.ParsePrefix(value)
	if err != nil {
		return "", fmt.Errorf("invalid CIDR")
	}
	if ipv6 != prefix.Addr().Is6() {
		if ipv6 {
			return "", fmt.Errorf("must be an IPv6 CIDR")
		}
		return "", fmt.Errorf("must be an IPv4 CIDR")
	}
	prefix = prefix.Masked()
	if (!ipv6 && prefix.Bits() > 30) || (ipv6 && prefix.Bits() > 126) {
		return "", fmt.Errorf("prefix is too small for a FakeIP pool")
	}
	for _, forbidden := range forbiddenFakeIPv4Prefixes {
		if !ipv6 && prefixesOverlap(prefix, forbidden) {
			return "", fmt.Errorf("overlaps reserved or local network %s", forbidden)
		}
	}
	for _, forbidden := range forbiddenFakeIPv6Prefixes {
		if ipv6 && prefixesOverlap(prefix, forbidden) {
			return "", fmt.Errorf("overlaps reserved or local network %s", forbidden)
		}
	}
	return prefix.String(), nil
}

func prefixesOverlap(a, b netip.Prefix) bool {
	if a.Addr().BitLen() != b.Addr().BitLen() {
		return false
	}
	return a.Contains(b.Addr()) || b.Contains(a.Addr())
}
