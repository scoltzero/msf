# Docker TUN Experimental Deployment

[中文版本](docker.md)

Docker deployment is still experimental and is not the recommended installation path yet. It is intended for users who understand Docker, TUN, static routes, and side-router integration. For production or long-term use, prefer [Linux tarball/systemd](install/linux.md), [fnOS FPK](install/fnos-fpk.md), or [Unraid PLG](install/unraid-plg.md).

Current release: `v0.3.8`

Current Docker experimental image:

```text
ghcr.io/scoltzero/msf:v0.3.8
```

This experimental image is not pushed as `latest`. To pull or deploy the Docker experimental version, explicitly use the `v0.3.8` tag.

## Current Status

- Docker defaults to Mihomo TUN and no longer asks MSF to write host nftables or policy routing rules.
- Two container network modes are supported: `host-tun` and `macvlan-tun`.
- `host-tun` is the default entry point and is suitable for regular Linux Docker hosts.
- `macvlan-tun` gives the container its own LAN IPv4 address and is suitable for Unraid Dockerman, `br0`, and custom network scenarios.
- Runtime data must be mapped to a host directory. The in-container data directory is fixed at `/opt/msf`; the default examples map host `./msf-data` to `/opt/msf`.
- `msf update` and WebUI self-update installation are disabled inside the container. Image upgrades must be handled through Docker, Compose, or your container manager.

If you need a stable deployment today, use Linux, fnOS, or Unraid PLG first.

## Runtime Requirements

Both network modes require the TUN device and network administration capabilities:

```yaml
cap_add:
  - NET_ADMIN
  - NET_RAW
devices:
  - /dev/net/tun:/dev/net/tun
```

Default Docker image environment:

```text
MSF_RUNTIME=docker
MSF_DOCKER_NETWORK_MODE=host-tun
MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT=false
```

In Docker TUN mode, the generated Mihomo config enables `tun.auto-route`, `tun.auto-detect-interface`, and `tun.route-address`, explicitly keeps `tun.dns-hijack=[]` and `tun.auto-redirect=false`, and sets `dns.proxy-server-nameserver`. MosDNS remains responsible for DNS splitting, while Mihomo only takes over Fake-IP and required public targets. This means MSF does not write host `table inet msf`, `fwmark 1 table 100`, `ip rule`, or `ip route` entries.

The data directory must be persisted:

```text
Host path   ->  Container path
./msf-data  ->  /opt/msf
```

MosDNS, Mihomo, Zashboard downloads, the database, configs, logs, and user-uploaded Mihomo configs are written under `/opt/msf`. If this directory is not mapped to the host, data will be lost after container recreation, and WebUI component downloads and config management cannot work reliably.

## Quick Start: host TUN

host TUN exposes the WebUI, DNS, and proxy services through the Docker host's LAN IP.

### Docker Compose

The repository already provides `docker-compose.yml`. If you need to create the file manually, copy the following content and save it as `docker-compose.yml`:

```yaml
services:
  msf:
    image: ghcr.io/scoltzero/msf:v0.3.8
    container_name: msf
    network_mode: host
    cap_add:
      - NET_ADMIN
      - NET_RAW
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      MSF_RUNTIME: docker
      MSF_DATA_DIR: /opt/msf
      MSF_DOCKER_NETWORK_MODE: host-tun
      MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT: "false"
    volumes:
      - ./msf-data:/opt/msf
    restart: unless-stopped
    stop_grace_period: 30s
```

Start it:

```bash
mkdir -p msf-data
docker compose up -d
```

The default compose file uses:

- Image: `ghcr.io/scoltzero/msf:v0.3.8`
- Network: `host`
- Data directory: `./msf-data:/opt/msf`
- WebUI: `http://<host-ip>:7777`
- Runtime marker: `MSF_RUNTIME=docker`
- Docker network mode: `MSF_DOCKER_NETWORK_MODE=host-tun`

### Plain Docker Script

On machines where Docker Compose is not suitable, run the script directly:

```bash
mkdir -p msf-data
./docker-run.sh
```

The equivalent core `docker run` arguments are:

```bash
docker run -d \
  --name msf \
  --network host \
  --cap-add NET_ADMIN \
  --cap-add NET_RAW \
  --device /dev/net/tun:/dev/net/tun \
  --restart unless-stopped \
  --stop-timeout 30 \
  -e MSF_RUNTIME=docker \
  -e MSF_DOCKER_NETWORK_MODE=host-tun \
  -e MSF_DATA_DIR=/opt/msf \
  -v "$PWD/msf-data:/opt/msf" \
  ghcr.io/scoltzero/msf:v0.3.8
```

## Quick Start: macvlan TUN

macvlan TUN assigns a dedicated LAN IPv4 address to the container. Router-side DHCP DNS and FakeIP static routes should point to this container IPv4 address, not the host IP.

### Docker Compose

The repository already provides `docker-compose.macvlan.yml`. If you need to create the file manually, copy the following content and save it as `docker-compose.macvlan.yml`:

```yaml
services:
  msf:
    image: ${MSF_IMAGE:-ghcr.io/scoltzero/msf:v0.3.8}
    container_name: ${MSF_CONTAINER_NAME:-msf}
    cap_add:
      - NET_ADMIN
      - NET_RAW
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      MSF_RUNTIME: docker
      MSF_DATA_DIR: /opt/msf
      MSF_DOCKER_NETWORK_MODE: macvlan-tun
      MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT: "false"
    volumes:
      - ${MSF_DOCKER_DATA_DIR:-./msf-data}:/opt/msf
    networks:
      msf_macvlan:
        ipv4_address: ${MSF_DOCKER_IPV4_ADDRESS:?set MSF_DOCKER_IPV4_ADDRESS}
    restart: unless-stopped
    stop_grace_period: 30s

networks:
  msf_macvlan:
    name: ${MSF_DOCKER_NETWORK_NAME:-msf-macvlan}
    driver: macvlan
    driver_opts:
      parent: ${MSF_DOCKER_PARENT_IFACE:?set MSF_DOCKER_PARENT_IFACE}
    ipam:
      config:
        - subnet: ${MSF_DOCKER_SUBNET:?set MSF_DOCKER_SUBNET}
          gateway: ${MSF_DOCKER_GATEWAY:?set MSF_DOCKER_GATEWAY}
```

Copy the example environment file and adjust it for your LAN:

```bash
cp docker.env.example .env
```

You can also copy this minimal macvlan compose `.env` example and save it as `.env`:

```text
MSF_IMAGE=ghcr.io/scoltzero/msf:v0.3.8
MSF_CONTAINER_NAME=msf
MSF_DOCKER_DATA_DIR=./msf-data
MSF_DOCKER_NETWORK_NAME=msf-macvlan
MSF_DOCKER_PARENT_IFACE=eth0
MSF_DOCKER_SUBNET=192.168.1.0/24
MSF_DOCKER_GATEWAY=192.168.1.1
MSF_DOCKER_IPV4_ADDRESS=192.168.1.10
```

For macvlan mode, at minimum you must change `MSF_DOCKER_PARENT_IFACE`, `MSF_DOCKER_SUBNET`, `MSF_DOCKER_GATEWAY`, and `MSF_DOCKER_IPV4_ADDRESS` to match your LAN.

Start it:

```bash
mkdir -p msf-data
docker compose -f docker-compose.macvlan.yml up -d
```

### Plain Docker Script

```bash
MSF_DOCKER_NETWORK_MODE=macvlan-tun \
MSF_DOCKER_PARENT_IFACE=eth0 \
MSF_DOCKER_SUBNET=192.168.1.0/24 \
MSF_DOCKER_GATEWAY=192.168.1.1 \
MSF_DOCKER_IPV4_ADDRESS=192.168.1.10 \
./docker-run.sh
```

The script creates the `msf-macvlan` Docker network if it does not already exist. Override the network name with `MSF_DOCKER_NETWORK_NAME` if needed.

## Unraid Dockerman IPv4 macvlan

The first Docker version supports manual Unraid Dockerman setup only. It does not provide a Community Applications container template.

1. Enable custom networks in Unraid Docker settings, and choose `macvlan` or the custom network implementation recommended for your current system.
2. Create a new container and set the image to `ghcr.io/scoltzero/msf:v0.3.8`.
3. Set Network Type to a custom LAN network such as `br0`.
4. Set Fixed IP address to a static IPv4 address outside your DHCP pool, for example `192.168.1.10`.
5. Add this to Extra Parameters or advanced parameters:

```text
--cap-add NET_ADMIN --cap-add NET_RAW --device /dev/net/tun:/dev/net/tun
```

6. Add environment variables:

| Variable | Value |
|---|---|
| `MSF_RUNTIME` | `docker` |
| `MSF_DOCKER_NETWORK_MODE` | `macvlan-tun` |
| `MSF_DATA_DIR` | `/opt/msf` |

7. Add a path mapping:

| Host path | Container path |
|---|---|
| `/mnt/user/appdata/msf-docker` | `/opt/msf` |

The WebUI URL is `http://<container-ipv4>:7777`.

## Router Integration

Open the WebUI for the first time and complete the setup wizard. Under Docker runtime, the setup page selects TUN mode by default.

Router-side configuration needs:

1. DHCP DNS pointing to the MSF address.
2. FakeIP static route pointing to the same MSF address.

Choose the MSF address by Docker mode:

| Docker mode | Router should point to |
|---|---|
| `host-tun` | Docker host LAN IP |
| `macvlan-tun` | Container dedicated LAN IPv4 |

Default FakeIP ranges:

| Type | Range |
|---|---|
| IPv4 | `28.0.0.0/8` |
| IPv6 | `f2b0::/18` |

The first macvlan version only targets IPv4 access. See [Router integration overview](guide/en/router-integration.md) for the full router-side guide.

## Script Variables

`docker-run.sh` supports:

| Variable | Default | Purpose |
|---|---|---|
| `MSF_IMAGE` | `ghcr.io/scoltzero/msf:v0.3.8` | Container image |
| `MSF_CONTAINER_NAME` | `msf` | Container name |
| `MSF_DOCKER_DATA_DIR` | `$PWD/msf-data` | Host data directory |
| `MSF_DOCKER_NETWORK_MODE` | `host-tun` | `host-tun` or `macvlan-tun` |
| `MSF_DOCKER_NETWORK_NAME` | `msf-macvlan` | Docker macvlan network name |
| `MSF_DOCKER_PARENT_IFACE` | unset | macvlan parent interface |
| `MSF_DOCKER_SUBNET` | unset | macvlan IPv4 subnet |
| `MSF_DOCKER_GATEWAY` | unset | macvlan IPv4 gateway |
| `MSF_DOCKER_IPV4_ADDRESS` | unset | Container static IPv4 address |

If a container with the same name already exists, stop and remove it first:

```bash
docker stop msf
docker rm msf
```

## Troubleshooting

### LXC / Proxmox reports missing `/dev/net/tun`

If deployment fails with:

```text
error gathering device information while adding custom device "/dev/net/tun": no such file or directory
```

the runtime that hosts the Docker daemon does not expose `/dev/net/tun`. If Docker runs inside an LXC container, check inside that LXC container:

```bash
ls -l /dev/net/tun
cat /dev/net/tun
```

Normally, `cat /dev/net/tun` should return something like `File descriptor in bad state`. If the file does not exist, load and pass through TUN from the outer host. For Proxmox LXC, a typical configuration is:

```bash
modprobe tun
```

```text
features: nesting=1
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

Restart the LXC container after changing its config. LXC permission models differ by platform, so use a privileged LXC or a VM if the platform cannot expose TUN reliably.

### v0.3.7 Docker TUN DNS / Fake-IP connection failures

`v0.3.7` has a defect in the default Docker TUN config: Mihomo may resolve proxy server domains to Fake-IP addresses such as `28.0.0.x`, then fail to dial them. Logs may also show repeated `127.0.0.1:8888 connection refused` messages or proxy server domain connection timeouts.

The fixed version unifies Linux TUN generation:

- `tun.stack` is `system`.
- `tun.dns-hijack` stays as an empty array so MosDNS continues DNS splitting.
- `tun.route-address` includes the Fake-IP ranges and required public targets.
- `tun.route-exclude-address` excludes LAN, loopback, link-local, and common China DNS addresses.
- `dns.proxy-server-nameserver` uses `223.5.5.5` and `119.29.29.29` so proxy server domains are not polluted by Fake-IP.

After upgrading to the fixed version, MSF automatically repairs the old TUN / DNS blocks at startup when you are still using generated config mode. If you switched Mihomo to custom config mode, MSF will not overwrite your file; adjust the fields above manually, or restore generated config from the WebUI and regenerate it.

### macvlan reports `invalid subinterface vlan name`

If deployment fails with a message like:

```text
invalid subinterface vlan name MSF_DOCKER_PARENT_IFACE:eth0, example formatting is eth0.10
```

Docker received an invalid macvlan `parent`. The `parent` must be a real interface in the Docker host environment, such as `eth0`, `ens18`, `br0`, or a VLAN subinterface like `eth0.10`.

The `.env` file must use equals-sign syntax:

```text
MSF_DOCKER_PARENT_IFACE=eth0
```

Do not write:

```text
MSF_DOCKER_PARENT_IFACE:eth0
```

In a Portainer Stack, set `MSF_DOCKER_PARENT_IFACE` as the environment variable name and `eth0` as its value. Do not enter `MSF_DOCKER_PARENT_IFACE:eth0` as one complete value. Verify the rendered compose config before deploying:

```bash
MSF_DOCKER_PARENT_IFACE=eth0 \
MSF_DOCKER_SUBNET=192.168.1.0/24 \
MSF_DOCKER_GATEWAY=192.168.1.1 \
MSF_DOCKER_IPV4_ADDRESS=192.168.1.10 \
docker compose -f docker-compose.macvlan.yml config
```

The output should contain:

```yaml
driver_opts:
  parent: eth0
```

## Update and Removal

`msf update` and WebUI self-update installation are disabled inside Docker containers. Upgrade the image by pulling the new image and recreating the container.

Docker Compose:

```bash
docker compose pull
docker compose up -d
```

Plain Docker:

```bash
docker pull ghcr.io/scoltzero/msf:v0.3.8
docker stop msf
docker rm msf
./docker-run.sh
```

Remove the container through Docker, Compose, or your container manager. The default host data directory is `./msf-data` in the current directory. Delete that directory manually only when you want to completely remove all persisted data.

MosDNS, Mihomo, and Zashboard component updates are still available from the WebUI.

## Common Ports

Docker TUN does not use TProxy or Redirect ports by default.

| Port | Purpose |
|---|---|
| `7777` | MSF WebUI |
| `53/tcp,udp` | MosDNS |
| `7890` | Mihomo HTTP proxy |
| `7891` | Mihomo SOCKS proxy |
| `7892` | Mihomo mixed proxy |
| `9090` | Mihomo controller / Zashboard |
| `9099` | MosDNS observability |
