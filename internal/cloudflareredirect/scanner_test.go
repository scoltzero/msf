package cloudflareredirect

import (
	"net/netip"
	"testing"
)

func TestSampleCandidateIPsIPv4AndIPv6(t *testing.T) {
	v4 := sampleCandidateIPs([]string{"192.0.2.0/24"}, "ipv4", 3)
	if len(v4) != 3 {
		t.Fatalf("ipv4 sample count = %d, want 3: %v", len(v4), v4)
	}
	prefix4 := netip.MustParsePrefix("192.0.2.0/24")
	for _, ip := range v4 {
		addr := netip.MustParseAddr(ip)
		if !addr.Is4() || !prefix4.Contains(addr) {
			t.Fatalf("ipv4 sample %s is outside %s", ip, prefix4)
		}
	}
	v6 := sampleCandidateIPs([]string{"2001:db8:1234::/48"}, "ipv6", 2)
	if len(v6) != 2 {
		t.Fatalf("ipv6 sample count = %d, want 2: %v", len(v6), v6)
	}
	prefix6 := netip.MustParsePrefix("2001:db8:1234::/48")
	for _, ip := range v6 {
		addr := netip.MustParseAddr(ip)
		if !addr.Is6() || !prefix6.Contains(addr) {
			t.Fatalf("ipv6 sample %s is outside %s", ip, prefix6)
		}
	}
}

func TestParseCFRayColo(t *testing.T) {
	if got := parseCFRayColo("8a1234567890abcd-HKG"); got != "HKG" {
		t.Fatalf("parseCFRayColo = %q, want HKG", got)
	}
	if got := parseCFRayColo("bad"); got != "" {
		t.Fatalf("parseCFRayColo bad = %q, want empty", got)
	}
}
