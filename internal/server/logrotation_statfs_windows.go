//go:build windows

package server

// freeBytesForDir is a no-op on windows (msf only ships to linux hosts);
// callers fall back to the default rotation tier.
func freeBytesForDir(path string) (uint64, bool) {
	return 0, false
}
