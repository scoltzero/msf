# RouterOS (MikroTik) → msf

For RouterOS v7, assuming msf and the transparent proxy run on the same host. RouterOS integration uses a single method: **the main router adds static routes directly** — no mangle / routing rules / policy routing (those only add FastTrack, Conntrack and troubleshooting complexity).

## Example environment

| Role | IPv4 | IPv6 |
|---|---|---|
| RouterOS gateway | `192.168.20.1` | `fd00:20::1/64` |
| msf host | `192.168.20.2` | `fd00:20::2/64` |

> Prefer ULA/GUA for the IPv6 next hop. If only link-local is available, specify the interface explicitly, e.g. `fe80::1234%bridge`.

## Step 1: DHCP DNS (recommended)

Point the DHCP network's DNS at the msf host:

```bash
/ip dhcp-server network set 0 dns-server=192.168.20.2
```

WinBox/WebFig: **IP → DHCP Server → Networks**, edit the network, set DNS server to the msf IPv4.

> Shortest path; MosDNS can see the client source address directly. Fine for most home networks.

## Step 2: FakeIP static routes (core)

IPv4:

```bash
/ip route
add distance=1 dst-address=28.0.0.0/8 gateway=192.168.20.2 comment="msf FakeIP v4"
# Optional: steer hardcoded public DNS to msf
add distance=1 dst-address=8.8.8.8/32 gateway=192.168.20.2 comment="msf DNS hijack"
add distance=1 dst-address=8.8.4.4/32 gateway=192.168.20.2 comment="msf DNS hijack"
add distance=1 dst-address=1.1.1.1/32 gateway=192.168.20.2 comment="msf DNS hijack"
add distance=1 dst-address=1.0.0.1/32 gateway=192.168.20.2 comment="msf DNS hijack"
```

IPv6:

```bash
/ipv6 route
add distance=1 dst-address=f2b0::/18 gateway=fd00:20::2 comment="msf FakeIP v6"
```

WinBox/WebFig: **IP → Routes / IPv6 → Routes → Add**, fill Dst. Address, Gateway, Distance=1 and a Comment.

## Step 3: Optional service ranges

If your rules direct Telegram, Netflix, etc. by IP range, use the same `/ip route` / `/ipv6 route` to point those ranges' gateway at the msf host — optional.

## Verification

Client:

```bash
nslookup google.com   # should fall within 28.0.0.0/8
dig AAAA google.com   # should fall within f2b0::/18
```

RouterOS:

```bash
/ip route print detail where dst-address=28.0.0.0/8
/ipv6 route print detail where dst-address=f2b0::/18
```

Confirm both FakeIP routes exist and the next hop points to the msf IPv4/IPv6.

Back to the [router integration overview](router-integration.md).
