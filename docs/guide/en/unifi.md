# UniFi (Ubiquiti) → msf

In the UniFi controller, steer the LAN DNS and FakeIP routes to the msf host.

## Example environment

| Role | IPv4 | IPv6 |
|---|---|---|
| UniFi gateway | `192.168.1.1` | `fd00::1` |
| msf host | `192.168.1.2` | `fd00::2` |

## Step 1: DHCP DNS

1. Go to **Settings → Networks**
2. Select your LAN network to edit
3. Find the **DHCP → DNS Server** section
4. Switch it to **Manual**
5. Set **DNS Server 1** to the msf host IP: `192.168.1.2`
6. Configure only this one DNS entry; leave the rest empty

## Step 2: FakeIP static routes (core)

In the routing / static routes area, add two routes:

IPv4:

- **Destination network**: `28.0.0.0/8`
- **Next hop**: `192.168.1.2`
- **Type**: Next Hop (or Gateway)

IPv6:

- **Destination network**: `f2b0::/18`
- **Next hop**: `fd00::2`
- **Type**: Next Hop (or Gateway)

> The exact location of "Static Routes" varies by controller version — usually under the Routing / Static Routes section of Settings.

## Step 3: Add public DNS and service IP routes

In the same Static Routes area, add the following IPv4 routes. Set every next hop to the msf host IPv4: `192.168.1.2`. These routes capture hardcoded public DNS and reduce Telegram / Netflix issues caused by bypassing msf through fixed public IPs.

| Destination network | Next hop | Comment |
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

## Verification

On a client:

```bash
nslookup google.com   # should fall within 28.0.0.0/8
dig AAAA google.com   # should fall within f2b0::/18
```

Back to the [router integration overview](router-integration.md).
