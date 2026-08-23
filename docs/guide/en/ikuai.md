# iKuai → msf

Steer the iKuai main router's DNS and FakeIP traffic to the msf host.

## Example environment

| Role | Address |
|---|---|
| iKuai gateway | `192.168.1.1` |
| msf host IPv4 | `192.168.1.2` |
| msf host IPv6 | `fd00::2` |

## Step 1: DHCP DNS

Go to **Network Settings → LAN → DHCP Server (address pool)** and edit the pool:

- **Primary DNS**: `192.168.1.2` (msf host IP)
- **Secondary DNS**: leave empty (do not add an ISP/public DNS, or some clients bypass msf)

## Step 2: FakeIP static routes (core)

Go to **Network Settings → Routing → Static Routes** and add:

| Destination / mask | Gateway | Comment |
|---|---|---|
| `28.0.0.0/8` | `192.168.1.2` | msf FakeIP v4 |
| `f2b0::/18` | `fd00::2` | msf FakeIP v6 |

> Menu paths differ slightly between iKuai versions: 3.X under "Network Settings → Static Routes", 4.X under "Network Configuration → Static Routes". For many entries you can prepare a CSV and use the Import function; before importing, replace every placeholder IP in the template with your `msf host IPv4` / `msf host IPv6`.

## Step 3: Optional extra routes

To capture hardcoded public DNS and keep Telegram / Netflix fixed-IP traffic flowing back to msf, add these IPv4 static routes:

| Destination / mask | Gateway | Comment |
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
nslookup google.com
```

The result should fall within `28.0.0.0/8`, confirming DNS now goes through msf. Use `dig AAAA google.com` to confirm the IPv6 result is within `f2b0::/18`.

Back to the [router integration overview](router-integration.md).
