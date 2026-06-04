# msm-free Unraid Plugin

This directory builds the Unraid plugin artifacts for `msm-free`.

Generated files:

- `dist/unraid/msm-free.plg`
- `dist/unraid/msm-free-<version>-x86_64-1.txz`
- `msm-free.plg`

Build:

```bash
make unraid VERSION=0.2.1 UNRAID_VERSION=0.2.1 GITHUB_REPO=scoltzero/msm-free RELEASE_TAG=v0.2.1
```

Publish the generated `.txz` package and `.plg` file to the GitHub release named by `RELEASE_TAG`, then commit the generated root `msm-free.plg` when you want a branch-based install URL.

Example:

```bash
gh release create v0.2.1 \
  dist/unraid/msm-free-0.2.1-x86_64-1.txz \
  dist/unraid/msm-free.plg \
  dist/msm-free-linux-amd64.tar.gz \
  dist/msm-free-linux-amd64.tar.gz.sha256 \
  dist/msm-free-linux-arm64.tar.gz \
  dist/msm-free-linux-arm64.tar.gz.sha256 \
  --title "v0.2.1" \
  --notes-file /tmp/msm-free-v0.2.1-release-notes.md
```

Recommended install URL for the v0.2.1 release:

```text
https://github.com/scoltzero/msm-free/releases/download/v0.2.1/msm-free.plg
```

Branch install URL, only after the generated root `msm-free.plg` has been committed to that branch:

```text
https://raw.githubusercontent.com/scoltzero/msm-free/<branch>/msm-free.plg
```

## Runtime Behavior

- The plugin installs the `msm-free` binary into `/usr/local/emhttp/plugins/msm-free/bin/msm-free`.
- The plugin registers the compatibility command `/usr/local/bin/msm`.
- The WebGUI control script is `/etc/rc.d/rc.msm-free`.
- Persistent config is `/boot/config/plugins/msm-free/msm-free.cfg`.
- Persistent application data defaults to `/mnt/user/appdata/msm-free`.
- On a fresh install, before setup exists, the plugin starts only the `msm-free` management WebUI. After setup is completed, `msm-free` restores enabled Mihomo, MosDNS and nftables state on subsequent starts.
- If the data directory is under `/mnt/user`, the rc script waits until the array user share path is available.

The MosDNS, Mihomo, and nftables behavior is controlled by `msm-free` itself after the user completes the setup wizard or changes service/network state in the WebUI.

## Stop and Uninstall

Stop the Unraid service without removing files:

```bash
/etc/rc.d/rc.msm-free stop
msm stop --config /mnt/user/appdata/msm-free
```

Restart it:

```bash
/etc/rc.d/rc.msm-free restart
msm restart --config /mnt/user/appdata/msm-free
```

Useful CLI commands:

```bash
msm status --config /mnt/user/appdata/msm-free
msm logs --config /mnt/user/appdata/msm-free --lines 200 mosdns
msm logs --config /mnt/user/appdata/msm-free --lines 200 mihomo
msm doctor --config /mnt/user/appdata/msm-free
msm license status
```

Do not use `msm update` or `msm uninstall` on Unraid. Updates and removal must go through the Unraid plugin manager so the `.plg` package state stays consistent.

Remove the plugin from the Unraid WebGUI plugin page. The plugin remove hook stops the rc service and removes the package files, but it keeps the application data directory by default:

```text
/mnt/user/appdata/msm-free
```

Delete that directory manually only when you want to remove all configuration, database, logs, downloaded components, and backups.
