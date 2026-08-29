package server

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type DownloadEvent struct {
	Status             string `json:"status"`
	Progress           int    `json:"progress"`
	Message            string `json:"message"`
	DownloadDigest     string `json:"download_digest,omitempty"`
	VerifiedDigest     string `json:"verified_digest,omitempty"`
	Verified           bool   `json:"verified,omitempty"`
	VerificationSource string `json:"verification_source,omitempty"`
}

const (
	componentVerificationSourceGitHubAssetDigest = "github_release_asset_digest"
	componentVerificationSourceLocalUpload       = "local-upload"
	defaultMihomoCoreSwitchAccelerator           = "https://gh-proxy.com/"
)

type componentDownloadAsset struct {
	URL                string
	Name               string
	Digest             string
	VerificationSource string
}

func (a *App) componentDownloadURL(component string) string {
	mihomoCoreType, amd64v3 := a.componentDownloadOptions()
	return componentDownloadURLFor(component, runtime.GOOS, runtime.GOARCH, mihomoCoreType, amd64v3)
}

func (a *App) componentDownloadOptions() (string, bool) {
	if a == nil || a.DB == nil {
		return "meta", false
	}
	var coreType string
	var amd64v3 bool
	err := a.DB.QueryRow(`select coalesce(mihomo_core_type,'meta'), amd64v3_enabled from system_setups order by id desc limit 1`).Scan(&coreType, &amd64v3)
	if err != nil {
		return "meta", false
	}
	return normalizeMihomoCoreType(coreType), amd64v3
}

func componentDownloadURLFor(component, goos, goarch, coreType string, amd64v3 bool) string {
	switch component {
	case "mihomo":
		if goos != "linux" && goos != "darwin" {
			return ""
		}
		if goarch != "amd64" && goarch != "arm64" {
			return ""
		}
		// Official Mihomo assets include the release tag in every filename, so
		// the concrete download URL is selected from the GitHub Release metadata.
		// Smart uses the vernesong/mihomo Prerelease-Alpha release, never the
		// official Meta release stream.
		if normalizeMihomoCoreType(coreType) == "smart" {
			return "https://github.com/vernesong/mihomo/releases/tag/Prerelease-Alpha"
		}
		return "https://github.com/MetaCubeX/mihomo/releases/latest"
	case "mosdns":
		if goos == "darwin" {
			switch goarch {
			case "amd64", "arm64":
				return fmt.Sprintf("https://github.com/yyysuo/mosdns/releases/latest/download/mosdns-darwin-%s.zip", goarch)
			default:
				return ""
			}
		}
		if goos != "linux" {
			return ""
		}
		arch := mosDNSAssetArch(goarch, amd64v3)
		if arch == "" {
			return ""
		}
		return fmt.Sprintf("https://github.com/yyysuo/mosdns/releases/latest/download/mosdns-linux-%s.zip", arch)
	case "zashboard", "ui":
		return "https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip"
	default:
		return ""
	}
}

func normalizeMihomoCoreType(value string) string {
	// First-class core types are exactly meta|smart. Legacy "alpha" values and
	// any invalid/empty selection safely normalize to stable Meta, while a
	// validated Smart selection is preserved for component download/update.
	if strings.EqualFold(strings.TrimSpace(value), "smart") {
		return "smart"
	}
	return "meta"
}

func mosDNSAssetArch(goarch string, amd64v3 bool) string {
	switch goarch {
	case "amd64":
		if amd64v3 {
			return "amd64-v3"
		}
		return "amd64"
	case "arm64":
		return "arm64"
	default:
		return ""
	}
}

func (a *App) installComponent(component string, emit func(DownloadEvent)) error {
	component = normalizeComponent(component)
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" && component != "zashboard" && component != "ui" {
		emit(DownloadEvent{Status: "skipped", Progress: 100, Message: "binary download is unsupported on this platform; place binary manually"})
		return nil
	}
	target := a.componentTarget(component)
	if target == "" {
		return fmt.Errorf("unknown component %s", component)
	}
	if _, err := os.Stat(target); err == nil {
		emit(DownloadEvent{Status: "running", Progress: 5, Message: component + " already installed; refreshing files"})
	}
	asset, err := a.componentDownloadAsset(component)
	if err != nil {
		return err
	}
	url := asset.URL
	emit(DownloadEvent{Status: "running", Progress: 5, Message: "downloading " + url})
	tmp := filepath.Join(a.DataDir, "data", component+".download")
	_ = os.Remove(tmp)
	verifiedDigest, err := a.downloadVerifiedFile(url, asset.Digest, tmp, emit)
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	verifiedEvent := DownloadEvent{
		Status:             "running",
		Progress:           58,
		Message:            "verified sha256 " + verifiedDigest,
		DownloadDigest:     asset.Digest,
		VerifiedDigest:     verifiedDigest,
		Verified:           true,
		VerificationSource: asset.VerificationSource,
	}
	emit(verifiedEvent)
	emit(DownloadEvent{Status: "running", Progress: 60, Message: "extracting"})
	if component == "zashboard" || component == "ui" {
		err := installZashboardArchive(tmp, filepath.Join(a.DataDir, "configs", "mihomo", "ui"))
		_ = os.Remove(tmp)
		if err != nil {
			return err
		}
		emit(DownloadEvent{Status: "completed", Progress: 100, Message: component + " installed", DownloadDigest: asset.Digest, VerifiedDigest: verifiedDigest, Verified: true, VerificationSource: asset.VerificationSource})
		return nil
	}
	extractDir, err := os.MkdirTemp(filepath.Join(a.DataDir, "data"), component+"-extract-*")
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	defer os.RemoveAll(extractDir)
	if strings.HasSuffix(url, ".zip") {
		if err := extractZipPreserve(tmp, extractDir); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	} else if strings.HasSuffix(url, ".gz") && !strings.HasSuffix(url, ".tar.gz") {
		if err := extractGzipBinary(tmp, filepath.Join(extractDir, component)); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	} else {
		if err := extractTarGzPreserve(tmp, extractDir); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	}
	_ = os.Remove(tmp)
	candidate := findUploadedBinary(extractDir, component)
	if candidate == "" {
		return fmt.Errorf("no %s binary found in downloaded package", component)
	}
	if err := validateUploadedLinuxBinary(candidate); err != nil {
		return err
	}
	if err := copyFile(candidate, target, 0755); err != nil {
		return err
	}
	_ = os.Chmod(target, 0755)
	if component == "mihomo" {
		if _, err := a.cacheMihomoCoreCandidate(a.selectedMihomoCoreType(), mihomoCoreCandidate{
			Binary: target, AssetURL: asset.URL, AssetName: asset.Name, Digest: asset.Digest,
			Version: a.componentCurrentVersion("mihomo"), VerificationSource: asset.VerificationSource,
		}); err != nil {
			return fmt.Errorf("cache installed Mihomo core: %w", err)
		}
	}
	emit(DownloadEvent{Status: "completed", Progress: 100, Message: component + " installed", DownloadDigest: asset.Digest, VerifiedDigest: verifiedDigest, Verified: true, VerificationSource: asset.VerificationSource})
	return nil
}

func (a *App) componentDownloadAsset(component string) (componentDownloadAsset, error) {
	component = normalizeComponent(component)
	url := a.componentDownloadURL(component)
	if url == "" {
		return componentDownloadAsset{}, fmt.Errorf("no download URL for %s on %s/%s", component, runtime.GOOS, runtime.GOARCH)
	}
	release, err := a.componentRemoteInfo(component)
	if err != nil {
		return componentDownloadAsset{}, fmt.Errorf("fetch %s release metadata before download: %w", component, err)
	}
	return a.componentDownloadAssetFromRelease(component, release)
}

func (a *App) componentDownloadAssetFromRelease(component string, release githubRelease) (componentDownloadAsset, error) {
	component = normalizeComponent(component)
	asset, ok := a.componentReleaseAsset(release, component)
	if !ok {
		want := a.componentReleaseAssetName(release, component)
		if want == "" {
			want = component
		}
		return componentDownloadAsset{}, fmt.Errorf("%s release metadata does not include expected asset %q", component, want)
	}
	if strings.TrimSpace(asset.BrowserDownloadURL) == "" {
		return componentDownloadAsset{}, fmt.Errorf("%s release asset %q has no download URL", component, asset.Name)
	}
	digest, err := canonicalSHA256Digest(asset.Digest)
	if err != nil {
		return componentDownloadAsset{}, fmt.Errorf("%s release asset %q has no valid SHA-256 digest; use local upload or wait for a verified release: %w", component, asset.Name, err)
	}
	return componentDownloadAsset{
		URL:                asset.BrowserDownloadURL,
		Name:               asset.Name,
		Digest:             digest,
		VerificationSource: componentVerificationSourceGitHubAssetDigest,
	}, nil
}

func (a *App) selectedMihomoCoreType() string {
	coreType, _ := a.componentDownloadOptions()
	return coreType
}

func (a *App) amd64v3Enabled() bool {
	_, amd64v3 := a.componentDownloadOptions()
	return amd64v3
}

func (a *App) persistMihomoCoreType(coreType string) error {
	value := normalizeMihomoCoreType(coreType)
	_, err := a.DB.Exec(`update system_setups set mihomo_core_type=?, updated_at=? where id=(select id from system_setups order by id desc limit 1)`, value, time.Now())
	return err
}

// componentDownloadAssetForCoreType resolves and returns the download asset for a
// specific Mihomo core type (meta|smart). Ordinary component update/check call
// componentDownloadAsset, which follows the active selected core; the switch
// endpoint uses this explicit variant so it never silently changes source.
func (a *App) componentDownloadAssetForCoreType(component, coreType string) (componentDownloadAsset, error) {
	component = normalizeComponent(component)
	coreType = normalizeMihomoCoreType(coreType)
	amd64v3 := a.amd64v3Enabled()
	url := componentDownloadURLFor(component, runtime.GOOS, runtime.GOARCH, coreType, amd64v3)
	if url == "" {
		return componentDownloadAsset{}, fmt.Errorf("no download URL for %s on %s/%s", component, runtime.GOOS, runtime.GOARCH)
	}
	release, err := a.componentRemoteInfoForCoreType(component, coreType)
	if err != nil {
		return componentDownloadAsset{}, fmt.Errorf("fetch %s release metadata before download: %w", component, err)
	}
	return a.componentDownloadAssetFromReleaseForCore(component, coreType, release)
}

func (a *App) componentDownloadAssetFromReleaseForCore(component, coreType string, release githubRelease) (componentDownloadAsset, error) {
	component = normalizeComponent(component)
	coreType = normalizeMihomoCoreType(coreType)
	amd64v3 := a.amd64v3Enabled()
	fallback := componentDownloadURLFor(component, runtime.GOOS, runtime.GOARCH, coreType, amd64v3)
	asset, ok := componentReleaseAssetForCore(release, component, runtime.GOOS, runtime.GOARCH, coreType, amd64v3, fallback)
	if !ok {
		want := componentReleaseAssetNameForCore(release, component, runtime.GOOS, runtime.GOARCH, coreType, amd64v3, fallback)
		if want == "" {
			want = component
		}
		return componentDownloadAsset{}, fmt.Errorf("%s release metadata does not include expected asset %q", component, want)
	}
	if strings.TrimSpace(asset.BrowserDownloadURL) == "" {
		return componentDownloadAsset{}, fmt.Errorf("%s release asset %q has no download URL", component, asset.Name)
	}
	digest, err := canonicalSHA256Digest(asset.Digest)
	if err != nil {
		return componentDownloadAsset{}, fmt.Errorf("%s release asset %q has no valid SHA-256 digest; use local upload or wait for a verified release: %w", component, asset.Name, err)
	}
	return componentDownloadAsset{
		URL:                asset.BrowserDownloadURL,
		Name:               asset.Name,
		Digest:             digest,
		VerificationSource: componentVerificationSourceGitHubAssetDigest,
	}, nil
}

// smartMihomoAssetContains returns deterministic, priority-ordered substrings
// used to select the vernesong/mihomo Prerelease-Alpha assets. Smart assets are
// named with an alpha-smart-<commit> suffix, so selection is by pattern rather
// than by joining a fixed release tag. Ordering is independent of asset order in
// the release metadata.
func smartMihomoAssetContains(goos, goarch string, amd64v3 bool) []string {
	if goos != "linux" && goos != "darwin" {
		return nil
	}
	if goarch != "amd64" && goarch != "arm64" {
		return nil
	}
	prefix := "mihomo-" + goos + "-" + goarch
	if goos == "darwin" && goarch == "amd64" {
		return []string{
			prefix + "-compatible-alpha-smart-",
			prefix + "-alpha-smart-",
		}
	}
	if goarch == "amd64" {
		if amd64v3 {
			return []string{
				prefix + "-v3-alpha-smart-",
				prefix + "-v1-alpha-smart-",
				prefix + "-alpha-smart-",
			}
		}
		return []string{
			prefix + "-v1-alpha-smart-",
			prefix + "-alpha-smart-",
		}
	}
	return []string{prefix + "-alpha-smart-"}
}

// smartMihomoVersionIdentity derives a version identity that changes when the
// asset commit/digest changes, so the fixed Prerelease-Alpha release tag alone
// never hides a new Smart build.
func smartMihomoVersionIdentity(release githubRelease, goos, goarch string, amd64v3 bool) string {
	asset, ok := componentReleaseAssetForCore(release, "mihomo", goos, goarch, "smart", amd64v3, "")
	if !ok {
		return strings.TrimSpace(release.TagName)
	}
	if commit := lastComponentCommitToken(asset.Name); commit != "" {
		return "Prerelease-Alpha-" + commit
	}
	if digest := canonicalDigestToken(asset.Digest); digest != "" {
		return "Prerelease-Alpha-" + digest
	}
	tag := strings.TrimSpace(release.TagName)
	if tag != "" {
		return tag
	}
	return asset.Name
}

func canonicalDigestToken(value string) string {
	raw := strings.ToLower(strings.TrimSpace(value))
	raw = strings.TrimPrefix(raw, "sha256:")
	raw = strings.Trim(raw, " \\t\\r\\n")
	if len(raw) == sha256.Size*2 {
		if _, err := hex.DecodeString(raw); err == nil {
			return raw
		}
	}
	return ""
}

// validateMihomoAssetArch ensures the selected asset targets the current
// operating system and architecture before a candidate is downloaded.
func validateMihomoAssetArch(assetName, goos, goarch string) error {
	name := strings.ToLower(strings.TrimSpace(assetName))
	if goos != "" && !strings.Contains(name, goos) {
		return fmt.Errorf("mihomo asset %q does not target %s", assetName, goos)
	}
	if goarch != "" && !strings.Contains(name, goarch) {
		return fmt.Errorf("mihomo asset %q does not target %s", assetName, goarch)
	}
	return nil
}

func (a *App) componentTarget(component string) string {
	switch component {
	case "mihomo":
		return filepath.Join(a.DataDir, "data/binaries/mihomo/mihomo")
	case "mosdns":
		return filepath.Join(a.DataDir, "data/binaries/mosdns/mosdns")
	case "zashboard", "ui":
		return filepath.Join(a.DataDir, "configs/mihomo/ui/index.html")
	default:
		return ""
	}
}

func extractGzipBinary(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	reader, err := gzip.NewReader(in)
	if err != nil {
		return err
	}
	defer reader.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, reader); err != nil {
		_ = out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Chmod(dst, 0755)
}

func (a *App) downloadFile(rawURL, dest string, emit func(DownloadEvent)) error {
	return a.downloadFileContext(context.Background(), rawURL, dest, emit)
}

func (a *App) downloadFileContext(ctx context.Context, rawURL, dest string, emit func(DownloadEvent)) error {
	return a.downloadResolvedURLContext(ctx, a.githubDownloadRouteURL(rawURL), dest, emit)
}

func (a *App) downloadResolvedURLContext(ctx context.Context, finalURL, dest string, emit func(DownloadEvent)) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return err
	}
	client := a.downloadHTTPClient()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, finalURL, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("download failed: %s", resp.Status)
	}
	if emit != nil {
		emit(DownloadEvent{Status: "running", Progress: 8, Message: "connected"})
	}
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()
	var written int64
	total := resp.ContentLength
	buf := make([]byte, 128*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := out.Write(buf[:n]); err != nil {
				return err
			}
			written += int64(n)
			if emit != nil && total > 0 {
				progress := 5 + int(float64(written)*50/float64(total))
				if progress > 55 {
					progress = 55
				}
				emit(DownloadEvent{Status: "running", Progress: progress, Message: fmt.Sprintf("downloaded %d/%d bytes", written, total)})
			} else if emit != nil {
				emit(DownloadEvent{Status: "running", Progress: 15, Message: fmt.Sprintf("downloaded %d bytes", written)})
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	return nil
}

func (a *App) downloadVerifiedFile(rawURL, expectedDigest, dest string, emit func(DownloadEvent)) (string, error) {
	return a.downloadVerifiedFileContext(context.Background(), rawURL, expectedDigest, dest, emit)
}

func (a *App) downloadVerifiedFileContext(ctx context.Context, rawURL, expectedDigest, dest string, emit func(DownloadEvent)) (string, error) {
	return a.downloadVerifiedResolvedURLContext(ctx, a.githubDownloadRouteURL(rawURL), expectedDigest, dest, emit)
}

func (a *App) downloadVerifiedResolvedURLContext(ctx context.Context, finalURL, expectedDigest, dest string, emit func(DownloadEvent)) (string, error) {
	expected, err := canonicalSHA256Digest(expectedDigest)
	if err != nil {
		return "", fmt.Errorf("download %s requires a valid SHA-256 digest: %w", finalURL, err)
	}
	if err := a.downloadResolvedURLContext(ctx, finalURL, dest, emit); err != nil {
		return "", err
	}
	actual, err := verifySHA256File(dest, expected)
	if err != nil {
		return actual, err
	}
	return actual, nil
}

func (a *App) mihomoCoreSwitchDownloadURL(rawURL string) string {
	return a.githubDownloadRouteURL(rawURL)
}

func verifySHA256File(path, expectedDigest string) (string, error) {
	expected, err := canonicalSHA256Digest(expectedDigest)
	if err != nil {
		return "", err
	}
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	actual := "sha256:" + hex.EncodeToString(h.Sum(nil))
	if actual != expected {
		return actual, fmt.Errorf("SHA-256 verification failed for %s: got %s, want %s", filepath.Base(path), actual, expected)
	}
	return actual, nil
}

func canonicalSHA256Digest(value string) (string, error) {
	raw := strings.ToLower(strings.TrimSpace(value))
	raw = strings.TrimPrefix(raw, "sha256:")
	if len(raw) != sha256.Size*2 {
		return "", fmt.Errorf("expected sha256:<64 hex chars>, got %q", value)
	}
	if _, err := hex.DecodeString(raw); err != nil {
		return "", err
	}
	return "sha256:" + raw, nil
}

func (a *App) DownloadFile(rawURL, dest string, emit func(DownloadEvent)) error {
	return a.downloadFile(rawURL, dest, emit)
}

func (a *App) downloadHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if a != nil && a.DB != nil {
		proxy := a.downloadProxyURL()
		if proxy == nil {
			proxy = a.runningMihomoDownloadProxyURL()
		}
		if proxy != nil {
			transport.Proxy = http.ProxyURL(proxy)
		}
	}
	return &http.Client{Timeout: 30 * time.Minute, Transport: transport}
}

// runningMihomoDownloadProxyURL lets component downloads use the already
// running Mihomo data plane when no explicit GitHub download proxy was saved.
// This is safe for core replacement because the candidate is fully downloaded
// and verified before the running core is stopped or replaced.
func (a *App) runningMihomoDownloadProxyURL() *url.URL {
	if a == nil || a.Services == nil || !a.Services.Status("mihomo").Running {
		return nil
	}
	proxy, err := a.mihomoExitProxyURL()
	if err != nil {
		return nil
	}
	return proxy
}

func (a *App) downloadProxyURL() *url.URL {
	var enabled bool
	var httpsProxy, httpProxy, socks5Proxy sql.NullString
	err := a.DB.QueryRow(`select github_proxy_enabled,github_https_proxy,github_http_proxy,github_socks5_proxy from system_setups order by id desc limit 1`).Scan(&enabled, &httpsProxy, &httpProxy, &socks5Proxy)
	if err != nil || !enabled {
		return nil
	}
	raw := strings.TrimSpace(httpsProxy.String)
	if raw == "" {
		raw = strings.TrimSpace(httpProxy.String)
	}
	if raw == "" {
		raw = strings.TrimSpace(socks5Proxy.String)
	}
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" {
		return nil
	}
	return u
}

func (a *App) githubDownloadRouteURL(raw string) string {
	if rewritten := a.rewriteDownloadURL(raw); rewritten != raw {
		return rewritten
	}
	if !isGitHubDownloadURL(raw) {
		return raw
	}
	if a.downloadProxyURL() != nil || a.runningMihomoDownloadProxyURL() != nil {
		return raw
	}
	return defaultMihomoCoreSwitchAccelerator + raw
}

func isGitHubDownloadURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "github.com" || host == "api.github.com" || host == "raw.githubusercontent.com" || strings.HasSuffix(host, ".githubusercontent.com")
}

func (a *App) rewriteDownloadURL(raw string) string {
	if a == nil || a.DB == nil || (!strings.Contains(raw, "github.com/") && !strings.Contains(raw, "githubusercontent.com/")) {
		return raw
	}
	var enabled bool
	var accelerator sql.NullString
	err := a.DB.QueryRow(`select github_accelerator_enabled,github_accelerator_url from system_setups order by id desc limit 1`).Scan(&enabled, &accelerator)
	if err != nil || !enabled {
		return raw
	}
	prefix := strings.TrimRight(strings.TrimSpace(accelerator.String), "/")
	if prefix == "" {
		return raw
	}
	return prefix + "/" + raw
}

func (a *App) EffectiveDownloadURL(raw string) string {
	return a.rewriteDownloadURL(raw)
}

func untarGz(src, dest string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := filepath.Base(h.Name)
		if name == "" || name == "." {
			continue
		}
		path := filepath.Join(dest, name)
		if h.FileInfo().IsDir() {
			_ = os.MkdirAll(path, 0755)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		out, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, h.FileInfo().Mode())
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, tr); err != nil {
			out.Close()
			return err
		}
		out.Close()
	}
	return nil
}

func patchZashboardIndex(uiDir string) error {
	indexPath := filepath.Join(uiDir, "index.html")
	body, err := os.ReadFile(indexPath)
	if err != nil {
		return err
	}
	html := string(body)
	if strings.Contains(html, "msf-zashboard-disk-backend") {
		return nil
	}
	if strings.Contains(html, "</head>") {
		html = strings.Replace(html, "</head>", zashboardDiskAutoBackendScript+"</head>", 1)
	} else {
		html = zashboardDiskAutoBackendScript + html
	}
	return os.WriteFile(indexPath, []byte(html), 0644)
}

const zashboardDiskAutoBackendScript = `<script id="msf-zashboard-disk-backend">
;(function () {
  try {
    if (!window.localStorage) return
    var host = window.location.hostname || "127.0.0.1"
    var listKey = "setup/api-list"
    var activeKey = "setup/active-uuid"
    var raw = localStorage.getItem(listKey)
    var list = []
    if (raw) {
      try {
        var parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) list = parsed
      } catch (_) {
        list = []
      }
    }
    var id = "msf-" + host.replace(/[^a-zA-Z0-9]/g, "-") + "-9090"
    var entry = {
      protocol: "http",
      secondaryPath: "",
      host: host,
      port: "9090",
      password: "",
      label: "msf",
      disableUpgradeCore: true,
      disableTunMode: false,
      uuid: id
    }
    var existing = list.find(function (item) { return item && item.uuid === id })
    if (existing) {
      Object.assign(existing, entry)
    } else {
      list.unshift(entry)
    }
    localStorage.setItem(listKey, JSON.stringify(list))
    localStorage.setItem(activeKey, id)
  } catch (err) {
    console.warn("msf zashboard disk backend preset failed", err)
  }
})()
</script>
`
