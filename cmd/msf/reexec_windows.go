//go:build windows

package main

import "errors"

func reexecCurrentProcess(string) error {
	return errors.New("process re-exec is unsupported on windows")
}
