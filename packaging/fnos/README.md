# fnOS .fpk packaging for msf

## Build

```bash
make fnos
```

This runs `make package` first (CGO_ENABLED=0 GOOS=linux GOARCH=amd64), then calls
`packaging/fnos/build-fpk.sh` which assembles the .fpk under `dist/`.

**Prerequisites:** `fnpack` in your PATH, or the build script will attempt to download
it from `static2.fnnas.com`.  On macOS the script uses `sips` for icon resizing
(falls back to a placeholder if unavailable).

## Install

- **App Center (manual):** Upload the `.fpk` via the fnOS App Center → Manual Install.
- **CLI:** `appcenter-cli install-local dist/msf_*.fpk`

## Runtime notes

- **Requires root.** msf supports both nftables/TProxy and Mihomo TUN, binds
  `:53` for DNS, and needs `run-as: root` plus the required network capabilities.
- The binary is installed to `/var/apps/msf/app/msf`, writeable data to
  `/var/apps/msf/var` (`$TRIM_PKGVAR`).
- The systemd unit (`msf.service`) is registered by fnOS (route 乙 in `resource`).
  The `cmd/main` start/stop/status handler also includes a `nohup` fallback for
  compatibility with non-systemd fnOS installs.
- `PATH` is extended to include `/usr/sbin` and `/sbin` so that `nft` and `ip` are
  found by the Go binary.
