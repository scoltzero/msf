package server

import (
	"bufio"
	"compress/gzip"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// Response compression for the big JSON payloads (proxies/overview responses
// measured in MB) and the embedded SPA bundle.  Compression is decided from
// the response Content-Type so SSE streams (text/event-stream) and WebSocket
// upgrades are never touched.  gzip writers are pooled — every API response
// cycles one.
var gzipWriterPool = sync.Pool{
	New: func() any { return gzip.NewWriter(io.Discard) },
}

func compressibleContentType(contentType string) bool {
	for _, prefix := range []string{
		"application/json",
		"text/html",
		"text/css",
		"text/javascript",
		"application/javascript",
		"application/wasm",
		"image/svg+xml",
		"text/plain",
	} {
		if strings.HasPrefix(contentType, prefix) {
			return true
		}
	}
	return false
}

// clientAcceptsGzip 解析 Accept-Encoding 并尊重 q 值：gzip;q=0（或
// *;q=0 且未显式列出 gzip）的客户端拿到压缩体会算协商失败；共享缓存
// 依赖 Vary: Accept-Encoding 区分两种表示。
func clientAcceptsGzip(r *http.Request) bool {
	encoding := r.Header.Get("Accept-Encoding")
	wildcardQuality := 0.0
	hasWildcard := false
	for _, part := range strings.Split(encoding, ",") {
		fields := strings.Split(part, ";")
		name := strings.ToLower(strings.TrimSpace(fields[0]))
		quality := 1.0
		for _, parameter := range fields[1:] {
			key, value, found := strings.Cut(strings.TrimSpace(parameter), "=")
			if !found || !strings.EqualFold(strings.TrimSpace(key), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			if err != nil || parsed < 0 || parsed > 1 {
				quality = 0
			} else {
				quality = parsed
			}
		}
		if name == "gzip" {
			return quality > 0
		}
		if name == "*" {
			hasWildcard = true
			wildcardQuality = quality
		}
	}
	return hasWildcard && wildcardQuality > 0
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	wroteHeader bool
	compressing bool
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	if !g.wroteHeader {
		g.wroteHeader = true
		// Never transform statusless/switching responses or an already
		// encoded one; only body-bearing, compressible content types.
		if code != http.StatusNoContent && code != http.StatusNotModified && code != http.StatusSwitchingProtocols &&
			g.Header().Get("Content-Encoding") == "" && compressibleContentType(g.Header().Get("Content-Type")) {
			g.Header().Set("Content-Encoding", "gzip")
			g.Header().Del("Content-Length")
			g.gz.Reset(g.ResponseWriter)
			g.compressing = true
		}
	}
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.wroteHeader {
		g.WriteHeader(http.StatusOK)
	}
	if g.compressing {
		return g.gz.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

func (g *gzipResponseWriter) Flush() {
	if g.compressing {
		_ = g.gz.Flush()
	}
	if flusher, ok := g.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (g *gzipResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hijacker, ok := g.ResponseWriter.(http.Hijacker); ok {
		return hijacker.Hijack()
	}
	return nil, nil, errors.New("response writer does not support hijacking")
}

func (g *gzipResponseWriter) finish() {
	if g.compressing {
		_ = g.gz.Close()
	}
	g.gz.Reset(io.Discard)
	gzipWriterPool.Put(g.gz)
}

// withResponseCompression wraps next for clients that advertise gzip support.
// It sits at the very outside of the middleware chain so every inner layer
// (logging recorder, auth, handlers) keeps working unchanged.  Vary is set on
// every pass — even uncompressed responses vary by Accept-Encoding, and a
// shared cache without that key would serve the wrong representation.
func withResponseCompression(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Accept-Encoding")
		if !clientAcceptsGzip(r) || r.Method == http.MethodHead {
			next.ServeHTTP(w, r)
			return
		}
		gz := &gzipResponseWriter{ResponseWriter: w, gz: gzipWriterPool.Get().(*gzip.Writer)}
		defer gz.finish()
		next.ServeHTTP(gz, r)
	})
}
