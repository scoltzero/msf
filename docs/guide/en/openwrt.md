# OpenWrt → msf

Use static routes + DHCP DNS so the OpenWrt main router steers traffic to the msf host. Shown with UCI commands (the same can be done in LuCI).

## Example environment

| Role | IPv4 | IPv6 |
|---|---|---|
| OpenWrt gateway | `192.168.1.1` | `fd00::1` |
| msf host | `192.168.1.2` | `fd00::2` |

## Step 1: FakeIP static routes (core)

IPv4:

```bash
uci add network route
uci set network.@route[-1].interface='lan'
uci set network.@route[-1].target='28.0.0.0'
uci set network.@route[-1].netmask='255.0.0.0'
uci set network.@route[-1].gateway='192.168.1.2'
```

IPv6:

```bash
uci add network route6
uci set network.@route6[-1].interface='lan'
uci set network.@route6[-1].target='f2b0::/18'
uci set network.@route6[-1].gateway='fd00::2'
```

Commit and apply:

```bash
uci commit network
/etc/init.d/network reload
```

To add public DNS, Telegram, and Netflix IPv4 static routes, append more `route` entries with `interface='lan'` and `gateway='192.168.1.2'`. In UCI, `/22` uses `255.255.252.0`, `/24` uses `255.255.255.0`, and `/32` uses `255.255.255.255`.

| Destination | Next hop | Comment |
|---|---|---|
| `8.8.8.8/32` | `192.168.1.2` | Public DNS |
| `8.8.4.4/32` | `192.168.1.2` | Public DNS |
| `1.1.1.1/32` | `192.168.1.2` | Public DNS |
| `1.0.0.1/32` | `192.168.1.2` | Public DNS |
| `149.154.160.0/22` | `192.168.1.2` | Telegram |
| `149.154.164.0/22` | `192.168.1.2` | Telegram |
| `149.154.172.0/22` | `192.168.1.2` | Telegram |
| `91.108.4.0/22` | `192.168.1.2` | Telegram |
| `91.108.20.0/22` | `192.168.1.2` | Telegram |
| `91.108.56.0/22` | `192.168.1.2` | Telegram |
| `91.108.8.0/22` | `192.168.1.2` | Telegram |
| `95.161.64.0/22` | `192.168.1.2` | Telegram |
| `91.108.12.0/22` | `192.168.1.2` | Telegram |
| `91.108.16.0/22` | `192.168.1.2` | Telegram |
| `67.198.55.0/24` | `192.168.1.2` | Telegram |
| `109.239.140.0/24` | `192.168.1.2` | Telegram |
| `207.45.72.0/22` | `192.168.1.2` | Netflix |
| `208.75.76.0/22` | `192.168.1.2` | Netflix |
| `210.0.153.0/24` | `192.168.1.2` | Netflix |
| `185.76.151.0/24` | `192.168.1.2` | Netflix |

> Append more `route6` entries for services (e.g. Telegram IPv6 ranges) with the same msf next hop as needed.

## Step 2: DHCP DNS

```bash
uci set dhcp.lan.dhcp_option='6,192.168.1.2'
uci commit dhcp
/etc/init.d/dnsmasq restart
```

DHCP option `6` is the DNS server advertised to clients — here the msf host.

> LuCI path: **Network → Interfaces → LAN → DHCP Server → Advanced Settings → DHCP-Options**, enter `6,192.168.1.2`.

## Verification

```bash
nslookup google.com 192.168.1.2   # should fall within 28.0.0.0/8
dig AAAA google.com @192.168.1.2  # should fall within f2b0::/18
```

Both IPv4 and IPv6 configs are required for full functionality.

Back to the [router integration overview](router-integration.md).
