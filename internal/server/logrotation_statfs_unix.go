//go:build !windows

package server

import "syscall"

// freeBytesForDir reports the filesystem free space for the directory that
// hosts the managed logs, in bytes.
func freeBytesForDir(path string) (uint64, bool) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, false
	}
	return uint64(stat.Bsize) * uint64(stat.Bavail), true
}
