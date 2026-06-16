# msf

`msf` is an open-source reimplementation of the MSM management experience for the `mssb`-style MosDNS + Mihomo stack.

> **Tip: Cloudflare Redirect is experimental.** The `msf cloudflare-redirect` CLI can rewrite user-selected Cloudflare-protected domains to locally scanned Cloudflare CDN IPv4/IPv6 addresses for direct clients only. Results depend on the msf host's ISP route, Cloudflare Anycast, IPv6 reachability, domain-list quality, and MosDNS config. It is not guaranteed to improve every site; please report issues with scan results, affected domains, and logs.

Current target:

- x86_64 Linux first.
- Mihomo is the only proxy core in scope for the first version.
- MosDNS, Mihomo, nftables transparent proxy, setup wizard, users, config history, logs and update APIs are implemented as open functionality.
- The generated runtime now follows the mssb MosDNS + Mihomo split-flow layout: MosDNS `:53`, Mihomo DNS `:6666`, fake-ip `28.0.0.0/8`, TProxy `7896`, redirect `7877`, plus the MosDNS-side `2222/3333/4444/5656/7777/8888/9099` ports.
- Sing-box is intentionally out of scope for the first version.
- Unraid plugin packaging is included as a second deployment target.
- Docker host-network deployment is included as another deployment target.
- The Cloudflare Redirect CLI plugin can rewrite selected Cloudflare-protected domains to locally scanned fast Cloudflare CDN IPv4/IPv6 addresses for direct clients only.

## Run Locally

```bash
go run ./cmd/msf serve -c ./data -p 7777
```

Then open `http://localhost:7777`.

## Install Linux x86_64 Release

```bash
curl -L -o msf-linux-amd64.tar.gz \
  https://github.com/scoltzero/msf/releases/download/v0.3.5/msf-linux-amd64.tar.gz
tar -xzf msf-linux-amd64.tar.gz -C /tmp
sudo /tmp/msf-*-linux-amd64/install.sh
```

The installer creates `/usr/local/bin/msf`, registers the compatibility command `/usr/local/bin/msm`, initializes `/opt/msf`, installs a systemd service, and starts the WebUI on port `7777`.

Open `http://<server-ip>:7777` and complete the setup wizard. After setup, `msf` persists the expected runtime state and restores Mihomo, MosDNS and nftables on subsequent starts unless the user explicitly stops or clears them.

Stop and uninstall:

```bash
sudo msf stop
sudo msf restart
msf logs --lines 200 mosdns
msf doctor
msf cloudflare-redirect status
sudo msf update
sudo msf uninstall
sudo msf uninstall --purge --yes
```

`msf uninstall` is only for Linux tarball/systemd installs. Docker, Unraid, and fnOS FPK installs should be removed through their container, plugin, or package manager.

Interactive terminals ask whether to remove the `/opt/msf` data directory. Non-interactive runs keep data by default. Pass `--purge --yes` to remove configs, database, logs, component binaries, and zashboard.

## Install Unraid Plugin

In Unraid WebGUI, open **Plugins / Install Plugin**, paste this URL, and install:

```text
https://raw.githubusercontent.com/scoltzero/msf/main/msf.plg
```

After installation, open **Settings / MSF Free**, then open the WebUI and complete the setup wizard. The Unraid Settings page is a lightweight plugin control page only; the full management interface runs in the separate msf WebUI.

On a fresh install, before setup exists, the plugin starts only the `msf` management WebUI. After setup is completed, `msf` restores enabled Mihomo, MosDNS and nftables state on subsequent starts.

Online MosDNS, Mihomo, and Zashboard installs verify the GitHub release asset SHA-256 digest before install. Local uploads remain user-supplied and are marked as `local-upload`.

Persistent Unraid data defaults to `/mnt/user/appdata/msf`.

## Docker

The Docker image uses host networking to preserve the same Linux runtime behavior as the tarball install. The container writes the host nftables and policy routing state, so br0, macvlan, ipvlan, bridge static IP, and port-mapped deployments are not equivalent supported modes.

With Docker Compose:

```bash
docker compose up -d
```

Without Docker Compose, use plain Docker:

```bash
./docker-run.sh
```

Both paths store persistent data in `./msf-data` by default and expose the WebUI at `http://<server-ip>:7777`.

See [Docker deployment](docs/docker.md) for the full `docker run` command, cleanup, and update contract.

## Cloudflare Redirect CLI Plugin

Cloudflare Redirect is an experimental CLI-only plugin for LAN clients that are configured to go direct instead of through the proxy. It scans fast Cloudflare CDN IPv4/IPv6 addresses from the msf host's own network path, then injects selected domains into the MosDNS direct-client branch.

It does not provide TCP forwarding, UI editing, automatic Cloudflare-domain detection, global `rewrite.txt` changes, or domestic upstream DNS changes. Proxy clients keep the normal FakeIP/proxy flow, because the best Cloudflare edge for a proxy VPS is not necessarily the best edge for the msf host.

Common commands:

```bash
sudo msf cloudflare-redirect status
sudo msf cloudflare-redirect scan
sudo msf cloudflare-redirect apply
sudo msf cloudflare-redirect start
sudo msf cloudflare-redirect stop
```

Short alias:

```bash
sudo msf cf-redirect status
sudo msf cf-redirect scan
```

Config file:

```text
<data-dir>/configs/cloudflare-redirect/cfyouxuan.yaml
```

The data directory is selected by deployment mode, not by CPU architecture. Common locations:

| Deployment | Data directory | Full YAML path |
|---|---|---|
| Linux systemd package, including amd64/arm64 | `/opt/msf` | `/opt/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Linux package with custom `--data-dir` | Custom path | `<custom-path>/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Unraid plugin | `/mnt/user/appdata/msf` | `/mnt/user/appdata/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Docker Compose / `docker-run.sh` host | Default `./msf-data` | `./msf-data/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Inside Docker container | `/opt/msf` | `/opt/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Local source run as non-root | Usually `./data`, depending on `-c` / `--config` | `./data/configs/cloudflare-redirect/cfyouxuan.yaml` |
| Raw binary run as root without environment variables | `/opt/msf` | `/opt/msf/configs/cloudflare-redirect/cfyouxuan.yaml` |

The effective priority is `MSF_DATA_DIR` > `MSM_FREE_DATA_DIR` > root default `/opt/msf` > non-root default `./data`. For systemd installs, the installer normally writes `MSF_DATA_DIR` into the service file, so the service configuration is authoritative.

Check the active path with:

```bash
sudo msf cloudflare-redirect status
```

The `config` field points to the `cfyouxuan.yaml` currently being used. The command auto-discovers the msf data directory from `MSF_DATA_DIR`, Unraid config, systemd service config, `.msf` compatibility paths, and common install paths. If needed:

```bash
sudo msf cloudflare-redirect status --config /path/to/msf-data
sudo msf cloudflare-redirect --config /path/to/msf-data status
```

Example:

```yaml
enabled: true

scan:
  interval: 6h
  concurrency: 100
  timeout: 1s
  max_duration: 2s
  test_domain: cloudflaremirrors.com/debian
  expected_status: 200
  port: 443
  tls: true
  colo_allowlist: []

  ipv4:
    enabled: true
    candidate_source: baipiao
    result_count: 2
    random_per_cidr: 1
  ipv6:
    enabled: auto
    candidate_source: baipiao
    result_count: 2
    random_per_cidr: 1
    no_winner_policy: passthrough

rules:
  manual:
    - domain:m-team.cc
    - domain:m-team.io
    - domain:open.cd
    - domain:hdfans.org
    - domain:hhanclub.net
    - domain:audiences.me
    - domain:plex.tv
    - domain:hdsky.me
    - domain:parsec.app
    - domain:ourbits.club
    - full:springsunday.net
    - full:www.springsunday.net
    - domain:pterclub.net
    - domain:ptskit.org
    - domain:totheglory.im
  subscriptions:
    - name: cf-domains
      enabled: true
      url: https://example.com/cloudflare-domains.txt
      format: domain-list
      interval: 24h

apply:
  ttl: 60
  rewrite_a: true
  rewrite_aaaa: auto
  restart_mosdns: auto
```

Key fields:

| Field | Default | Description |
|---|---|---|
| `enabled` | `false` | Main switch. When false, `scan` is allowed but `apply` removes MosDNS injection. |
| `scan.interval` | `6h` | Automatic CDN re-scan interval after startup. |
| `scan.concurrency` | `100` | Concurrent probe count. |
| `scan.test_domain` | `cloudflaremirrors.com/debian` | Domain used to verify Cloudflare edge IPs. |
| `scan.colo_allowlist` | `[]` | Optional Cloudflare colo filter, for example `["HKG", "NRT", "SIN"]`. |
| `scan.ipv4.enabled` | `true` | Enable IPv4 scanning. |
| `scan.ipv4.result_count` | `2` | Keep this many best IPv4 results. |
| `scan.ipv6.enabled` | `auto` | Enable IPv6 scanning automatically when the current MosDNS IPv6 setting allows it. |
| `scan.ipv6.result_count` | `2` | Keep this many best IPv6 results. |
| `rules.manual` | `[]` | Manual domain rules. Supports `domain:`, `full:`, `keyword:`, `regexp:`, bare domains, and common `DOMAIN-SUFFIX,...` formats. |
| `rules.subscriptions` | `[]` | Remote domain-list subscriptions. |
| `apply.rewrite_a` | `true` | Generate A-record rewrites. |
| `apply.rewrite_aaaa` | `auto` | Generate AAAA rewrites only when IPv6 is enabled and scan results exist. |
| `apply.restart_mosdns` | `auto` | Restart MosDNS after apply/stop so config changes take effect. |

After `start`, the daemon reads `cfyouxuan.yaml` immediately. If `enabled: true`, it always runs one fresh scan and apply. After that, it checks the YAML every minute, while later Cloudflare CDN re-scans follow `scan.interval` (`6h` by default). Running `start` again while the daemon is already running also triggers one synchronous `scan + apply`.

Recommended flow:

```bash
sudo nano <data-dir>/configs/cloudflare-redirect/cfyouxuan.yaml
sudo msf cloudflare-redirect start
sudo msf cloudflare-redirect status
```

Use `status.hints` to diagnose common problems such as `enabled=false`, no scanned IPs, no domains, or pending MosDNS injection.

## Build From Source

```bash
make build
make unraid VERSION=0.3.5 UNRAID_VERSION=0.3.5 GITHUB_REPO=scoltzero/msf RELEASE_TAG=v0.3.5
```

The generated artifacts are:

- `dist/msf-linux-amd64.tar.gz`
- `dist/unraid/msf-<version>-x86_64-1.txz`
- `msf.plg`

## Runtime Layout

The data directory defaults to `/opt/msf` on generic Linux and `/mnt/user/appdata/msf` on Unraid. It contains:

- `configs/mosdns`
- `configs/mihomo`
- `configs/network`
- `data/binaries`
- `logs`
- `database`
- `backups`

## Service Port Allocation

Ports below are the ones the project actually listens on (taken from the diagnostic/health-check lists in `internal/server`). supervisor manages processes over a unix socket and uses no TCP port, so it is not listed.

| Service | Port | Description |
|---|---|---|
| msf | 7777 | Web management UI (default `-p 7777`); also reused by mosdns to resolve node domains |
| mosdns | 53 | DNS service entry |
| mosdns | 2222 | Internal domestic DNS server |
| mosdns | 3333 | Forward overseas queries to the internal cache-with-expiry service |
| mosdns | 4444 | Overseas DNS server with expiring cache (internal/external use) |
| mosdns | 5656 | Main routing/split server |
| mosdns | 6666 | DNS bridge to mihomo/sing-box |
| mosdns | 8888 | Internal DNS (proxy core's `default-nameserver` upstream) |
| mosdns | 9099 | MosDNS stats / API endpoint |
| mihomo/sing-box | 7890 | HTTP proxy |
| mihomo/sing-box | 7891 | SOCKS5 proxy |
| mihomo/sing-box | 7892 | Mixed port |
| mihomo/sing-box | 7896 | TProxy transparent proxy (used by nftables policy) |
| mihomo/sing-box | 7877 | Redirect proxy (used by nftables policy) |
| mihomo/sing-box | 9090 | External controller / web UI (zashboard) |

## Router Integration (make LAN devices use msf)

msf runs as a **bypass router** by default: it is not the main gateway. The main router steers **DNS queries** and **traffic to be proxied** to the msf host. Two steps are required on the main router:

1. **Redirect DHCP DNS** to the msf host (MosDNS `:53`).
2. **Add FakeIP static routes** with the msf host as next hop.

| Type | Destination (msf default) | Next hop |
|---|---|---|
| IPv4 | `28.0.0.0/8` | msf host IPv4 |
| IPv6 | `f2b0::/18` | msf host IPv6 |

> DNS alone is not enough: FakeIP addresses are virtual, and without a return route they are dropped or sent out directly. Both steps are required. The FakeIP ranges must match your setup-wizard configuration.

Step-by-step guides per main router:

- [Router integration overview](docs/guide/en/router-integration.md)
- [RouterOS (MikroTik)](docs/guide/en/routeros.md)
- [iKuai](docs/guide/en/ikuai.md)
- [OpenWrt](docs/guide/en/openwrt.md)
- [UniFi (Ubiquiti)](docs/guide/en/unifi.md)

Verify: on a client, `nslookup google.com` should fall within `28.0.0.0/8` and `dig AAAA google.com` within `f2b0::/18`.

## Notes

This project does not contain MSM closed-source backend code. The UI and API behavior are reimplemented from public documentation, mssb behavior, and local compatibility observations.

## Acknowledgements

`msf` is a non-commercial open reimplementation of the MSM-style management experience. It is based on MSM's user-facing appearance and reconstructed around the mssb-style MosDNS + Mihomo workflow.

Thanks to:

- `msm9527/msm-wiki`, used as the public reference for the MSM management experience.
- `baozaodetudou/mssb`, used as the public reference for the MosDNS + Mihomo backend behavior.

This project is not affiliated with the upstream MSM or mssb projects.
