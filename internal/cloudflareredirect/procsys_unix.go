//go:build !windows

package cloudflareredirect

import (
	"os/exec"
	"syscall"
)

// setProcessGroup puts the child in its own process group (Unix) so signals
// delivered to msf do not cascade into the helper process.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}
