package server

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientAcceptsGzipHonorsQuality(t *testing.T) {
	tests := []struct {
		header string
		want   bool
	}{
		{header: "gzip", want: true},
		{header: "br, gzip;q=0.5", want: true},
		{header: "gzip;q=0, *;q=1", want: false},
		{header: "br, *;q=0.8", want: true},
		{header: "gzip;q=bogus", want: false},
	}
	for _, tc := range tests {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Accept-Encoding", tc.header)
		if got := clientAcceptsGzip(req); got != tc.want {
			t.Fatalf("Accept-Encoding %q: got %v want %v", tc.header, got, tc.want)
		}
	}
}

func TestResponseCompressionSetsVaryAndSkipsRejectedGzip(t *testing.T) {
	handler := withResponseCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true}`))
	}))

	rejected := httptest.NewRequest(http.MethodGet, "/", nil)
	rejected.Header.Set("Accept-Encoding", "gzip;q=0")
	rejectedResponse := httptest.NewRecorder()
	handler.ServeHTTP(rejectedResponse, rejected)
	if rejectedResponse.Header().Get("Content-Encoding") != "" {
		t.Fatal("response was compressed despite gzip;q=0")
	}
	if !strings.Contains(rejectedResponse.Header().Get("Vary"), "Accept-Encoding") {
		t.Fatalf("uncompressed response missing Vary header: %q", rejectedResponse.Header().Get("Vary"))
	}

	accepted := httptest.NewRequest(http.MethodGet, "/", nil)
	accepted.Header.Set("Accept-Encoding", "gzip")
	acceptedResponse := httptest.NewRecorder()
	handler.ServeHTTP(acceptedResponse, accepted)
	if acceptedResponse.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("gzip response encoding = %q", acceptedResponse.Header().Get("Content-Encoding"))
	}
	reader, err := gzip.NewReader(acceptedResponse.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != `{"success":true}` {
		t.Fatalf("decompressed body = %q", body)
	}
}
