package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMosDNSQueryParsingSkipsServiceLogs(t *testing.T) {
	lines := []string{
		`2026-07-29T18:50:55.302+0800 INFO starting proxy at 127.0.0.1:7891`,
		`loaded rules from client_ip.txt`,
		`compiled regexp:^240[0-9a-f]-.*\.free-lbv6\.idouyinvod\.com$`,
		`{"level":"info","time":"2026-07-29T18:50:55.302+08:00","msg":"loaded","name":"client_ip.txt"}`,
		`client_ip=192.168.10.223 query_name=valid.example qtype=A rule=unmatched_rule rcode=NOERROR duration=0.25ms`,
		`2026-07-29 18:50:56 query AAAA ipv6.example from 192.168.10.224 cost 1.5ms`,
	}

	entries := parseMosDNSQueryEntries(lines)
	if len(entries) != 2 {
		t.Fatalf("expected only query records, got %d: %#v", len(entries), entries)
	}
	if got := stringMapValue(entries[0], "query_name"); got != "valid.example" {
		t.Fatalf("explicit query name=%q", got)
	}
	if got := stringMapValue(entries[1], "query_name"); got != "ipv6.example" {
		t.Fatalf("fallback query name=%q", got)
	}
}

func TestMosDNSQueryFilteringDoesNotDuplicateRows(t *testing.T) {
	entries := parseMosDNSQueryEntries([]string{
		`client_ip=192.168.10.2 query_name=one.example qtype=A rule=direct rcode=NOERROR`,
		`client_ip=192.168.10.3 query_name=two.example qtype=AAAA rule=direct rcode=NOERROR`,
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/mosdns/query-log", nil)
	filtered := filterMosDNSQueryEntries(entries, req)
	if len(filtered) != len(entries) {
		t.Fatalf("query filtering changed row count: got=%d want=%d", len(filtered), len(entries))
	}
}

func TestNormalizeMosDNSQueryNameRejectsNonDomains(t *testing.T) {
	for _, value := range []string{
		"2026-07-29T18:50:55.302+0800",
		"127.0.0.1:7891",
		`regexp:^ntp[1-2]?\..*\.com$`,
	} {
		if got := normalizeMosDNSQueryName(value); got != "" {
			t.Fatalf("normalizeMosDNSQueryName(%q)=%q, want empty", value, got)
		}
	}
	for _, value := range []string{"example.com", "_dns._udp.example.com", "域名.中国"} {
		if got := normalizeMosDNSQueryName(value); got != value {
			t.Fatalf("normalizeMosDNSQueryName(%q)=%q", value, got)
		}
	}
}

func TestNormalizeMosDNSQueryMapPreservesAnswerDetails(t *testing.T) {
	entry := normalizeMosDNSQueryMap(map[string]any{
		"query_name":    "answer.example",
		"query_type":    "A",
		"response_code": "NOERROR",
		"answers": []any{
			map[string]any{"type": "CNAME", "ttl": float64(60), "data": "edge.example."},
			map[string]any{"type": "A", "ttl": float64(30), "data": "192.0.2.10"},
		},
	}, 0, "")
	answers := anySlice(entry["answers"])
	if len(answers) != 2 {
		t.Fatalf("answers=%#v, want two records", answers)
	}
	second, ok := answers[1].(map[string]any)
	if !ok || second["type"] != "A" || second["data"] != "192.0.2.10" || second["ttl"] != float64(30) {
		t.Fatalf("A answer details were not preserved: %#v", answers[1])
	}
}
