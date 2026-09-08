package server

import "testing"

func TestSystemDNSNameserverAccepted(t *testing.T) {
	local := map[string]bool{"127.0.0.1": true, "::1": true, "localhost": true, "192.168.1.10": true, "fe80::1": true}
	cases := []struct {
		name string
		want string
		item string
		ok   bool
	}{
		{"loopback exact match", "127.0.0.1", "127.0.0.1", true},
		{"loopback to host lan ip", "127.0.0.1", "192.168.1.10", true},
		{"host lan ip to loopback", "192.168.1.10", "127.0.0.1", true},
		{"host lan ip exact match", "192.168.1.10", "192.168.1.10", true},
		{"ipv6 loopback", "127.0.0.1", "::1", true},
		{"ipv6 link local", "127.0.0.1", "fe80::1", true},
		{"remote upstream", "127.0.0.1", "223.5.5.5", false},
		{"remote with remote want", "223.5.5.5", "8.8.8.8", false},
		{"want remote item local", "8.8.8.8", "127.0.0.1", false},
	}
	for _, tc := range cases {
		if got := systemDNSNameserverAccepted(tc.want, tc.item, local); got != tc.ok {
			t.Fatalf("%s: systemDNSNameserverAccepted(%q, %q) = %t, want %t", tc.name, tc.want, tc.item, got, tc.ok)
		}
	}
}

func TestLocalDNSAddressSetIncludesLoopback(t *testing.T) {
	set := localDNSAddressSet()
	for _, item := range []string{"127.0.0.1", "::1", "localhost"} {
		if !set[item] {
			t.Fatalf("expected loopback %s in local address set: %#v", item, set)
		}
	}
}
