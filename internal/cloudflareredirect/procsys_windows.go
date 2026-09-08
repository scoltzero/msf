//go:build windows

package cloudflareredirect

import "os/exec"

// setProcessGroup is a no-op on Windows: syscall.SysProcAttr there has no
// Setpgid field, and job objects (if ever needed) would be the mechanism.
func setProcessGroup(cmd *exec.Cmd) {}
