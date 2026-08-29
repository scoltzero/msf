package server

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestMihomoCoreCacheVerifiesBinaryAndResolvesWithoutDownload(t *testing.T) {
	app := newTestApp(t)
	source := writeCandidateScript(t, app, false)
	cached, err := app.cacheMihomoCoreCandidate("smart", mihomoCoreCandidate{
		Binary: source, Version: "alpha-smart-test", AssetURL: "https://example.invalid/smart.gz",
		AssetName: "smart.gz", Digest: testSHA256Digest([]byte("asset")),
		VerificationSource: componentVerificationSourceGitHubAssetDigest,
	})
	if err != nil {
		t.Fatal(err)
	}
	if cached.Binary != app.mihomoCoreCachePath("smart") || !fileExists(cached.Binary) {
		t.Fatalf("cached candidate = %+v", cached)
	}
	var events []DownloadEvent
	resolved, err := app.resolveMihomoCoreCandidate(context.Background(), "smart", func(event DownloadEvent) {
		events = append(events, event)
	})
	if err != nil {
		t.Fatal(err)
	}
	if !resolved.FromCache || resolved.Binary != cached.Binary {
		t.Fatalf("resolved candidate did not use cache: %+v", resolved)
	}
	if len(events) == 0 || events[len(events)-1].Progress != 100 || !strings.Contains(events[len(events)-1].Message, "cached") {
		t.Fatalf("cache progress event = %+v", events)
	}
}

func TestMihomoCoreCacheRejectsCorruption(t *testing.T) {
	app := newTestApp(t)
	source := writeCandidateScript(t, app, false)
	cached, err := app.cacheMihomoCoreCandidate("meta", mihomoCoreCandidate{Binary: source})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cached.Binary, []byte("corrupt"), 0755); err != nil {
		t.Fatal(err)
	}
	if _, ok := app.cachedMihomoCoreCandidate("meta"); ok {
		t.Fatal("corrupt core cache was accepted")
	}
}
