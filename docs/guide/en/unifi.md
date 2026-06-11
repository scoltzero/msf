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

## Verification

On a client:

```bash
nslookup google.com   # should fall within 28.0.0.0/8
dig AAAA google.com   # should fall within f2b0::/18
```

Back to the [router integration overview](router-integration.md).
