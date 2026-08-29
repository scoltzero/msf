package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const mihomoCoreCacheVerificationSource = "cached_binary_sha256"

type mihomoCoreCacheReceipt struct {
	CoreType           string    `json:"core_type"`
	BinaryDigest       string    `json:"binary_digest"`
	AssetDigest        string    `json:"asset_digest,omitempty"`
	VerificationSource string    `json:"verification_source"`
	Version            string    `json:"version,omitempty"`
	AssetURL           string    `json:"asset_url,omitempty"`
	AssetName          string    `json:"asset_name,omitempty"`
	CachedAt           time.Time `json:"cached_at"`
}

func (a *App) mihomoCoreCachePath(coreType string) string {
	return filepath.Join(a.DataDir, "data", "binaries", "mihomo", "cores", normalizeMihomoCoreType(coreType), "mihomo")
}

func mihomoCoreCacheReceiptPath(binaryPath string) string {
	return binaryPath + ".json"
}

func sha256FileDigest(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return "sha256:" + hex.EncodeToString(hash.Sum(nil)), nil
}

func (a *App) cacheMihomoCoreCandidate(coreType string, candidate mihomoCoreCandidate) (mihomoCoreCandidate, error) {
	coreType = normalizeMihomoCoreType(coreType)
	if strings.TrimSpace(candidate.Binary) == "" {
		return mihomoCoreCandidate{}, fmt.Errorf("%s core candidate has no binary", coreType)
	}
	binaryDigest, err := sha256FileDigest(candidate.Binary)
	if err != nil {
		return mihomoCoreCandidate{}, fmt.Errorf("hash %s core binary: %w", coreType, err)
	}
	target := a.mihomoCoreCachePath(coreType)
	if err := copyFile(candidate.Binary, target, 0755); err != nil {
		return mihomoCoreCandidate{}, fmt.Errorf("cache %s core binary: %w", coreType, err)
	}
	if _, err := verifySHA256File(target, binaryDigest); err != nil {
		return mihomoCoreCandidate{}, fmt.Errorf("verify cached %s core binary: %w", coreType, err)
	}
	verificationSource := strings.TrimSpace(candidate.VerificationSource)
	if verificationSource == "" {
		verificationSource = mihomoCoreCacheVerificationSource
	}
	receipt := mihomoCoreCacheReceipt{
		CoreType: coreType, BinaryDigest: binaryDigest, AssetDigest: candidate.Digest,
		VerificationSource: verificationSource, Version: candidate.Version,
		AssetURL: candidate.AssetURL, AssetName: candidate.AssetName, CachedAt: time.Now(),
	}
	if err := writeMihomoCoreCacheReceipt(mihomoCoreCacheReceiptPath(target), receipt); err != nil {
		return mihomoCoreCandidate{}, err
	}
	return mihomoCoreCandidate{
		Binary: target, AssetURL: receipt.AssetURL, AssetName: receipt.AssetName,
		Digest: firstNonEmpty(receipt.AssetDigest, receipt.BinaryDigest), Version: receipt.Version,
		VerificationSource: receipt.VerificationSource,
	}, nil
}

func (a *App) cachedMihomoCoreCandidate(coreType string) (mihomoCoreCandidate, bool) {
	coreType = normalizeMihomoCoreType(coreType)
	target := a.mihomoCoreCachePath(coreType)
	raw, err := os.ReadFile(mihomoCoreCacheReceiptPath(target))
	if err != nil {
		return mihomoCoreCandidate{}, false
	}
	var receipt mihomoCoreCacheReceipt
	if json.Unmarshal(raw, &receipt) != nil || receipt.CoreType != coreType || strings.TrimSpace(receipt.BinaryDigest) == "" {
		return mihomoCoreCandidate{}, false
	}
	if _, err := verifySHA256File(target, receipt.BinaryDigest); err != nil {
		return mihomoCoreCandidate{}, false
	}
	if err := os.Chmod(target, 0755); err != nil {
		return mihomoCoreCandidate{}, false
	}
	return mihomoCoreCandidate{
		Binary: target, AssetURL: receipt.AssetURL, AssetName: receipt.AssetName,
		Digest: firstNonEmpty(receipt.AssetDigest, receipt.BinaryDigest), Version: receipt.Version,
		VerificationSource: firstNonEmpty(receipt.VerificationSource, mihomoCoreCacheVerificationSource),
	}, true
}

func writeMihomoCoreCacheReceipt(path string, receipt mihomoCoreCacheReceipt) error {
	raw, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".mihomo-core-cache-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Chmod(0600); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}
