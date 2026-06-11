# RouterOS（MikroTik）接入 msf

适用于 RouterOS v7。假设 msf 与透明代理跑在同一台主机上。RouterOS 接入只用一种方式：**主路由直接添加静态路由**，不使用 mangle / routing rule / 策略路由（那会徒增 FastTrack、Conntrack 和排错复杂度）。

## 示例环境

| 角色 | IPv4 | IPv6 |
|---|---|---|
| RouterOS 网关 | `192.168.20.1` | `fd00:20::1/64` |
| msf 主机 | `192.168.20.2` | `fd00:20::2/64` |

> IPv6 静态路由的下一跳建议用 ULA/GUA；若只有 link-local，需显式指定出接口，例如 `fe80::1234%bridge`。

## 第 1 步：DHCP 下发 DNS（推荐）

把 DHCP 网络的 DNS 指向 msf 主机：

```bash
/ip dhcp-server network set 0 dns-server=192.168.20.2
```

WinBox/WebFig：**IP → DHCP Server → Networks**，编辑对应网络，将 DNS server 设为 msf 的 IPv4。

> 优点：路径最短，MosDNS 能直接识别客户端源地址，适合大多数家庭网络。

## 第 2 步：FakeIP 静态路由（核心）

IPv4：

```bash
/ip route
add distance=1 dst-address=28.0.0.0/8 gateway=192.168.20.2 comment="msf FakeIP v4"
# 可选：把硬编码公共 DNS 也引到 msf
add distance=1 dst-address=8.8.8.8/32 gateway=192.168.20.2 comment="msf DNS hijack"
add distance=1 dst-address=8.8.4.4/32 gateway=192.168.20.2 comment="msf DNS hijack"
add distance=1 dst-address=1.1.1.1/32 gateway=192.168.20.2 comment="msf DNS hijack"
add distance=1 dst-address=1.0.0.1/32 gateway=192.168.20.2 comment="msf DNS hijack"
```

IPv6：

```bash
/ipv6 route
add distance=1 dst-address=f2b0::/18 gateway=fd00:20::2 comment="msf FakeIP v6"
```

WinBox/WebFig：**IP → Routes / IPv6 → Routes → Add**，逐条填写 Dst. Address、Gateway、Distance=1 和 Comment。

## 第 3 步：可选服务网段

如分流规则按 IP 段直连 Telegram、Netflix 等，可用同样的 `/ip route` / `/ipv6 route` 把对应网段的 gateway 指到 msf 主机，按需添加，不是必须项。

## 验证

客户端：

```bash
nslookup google.com   # 结果应落在 28.0.0.0/8
dig AAAA google.com   # 结果应落在 f2b0::/18
```

RouterOS：

```bash
/ip route print detail where dst-address=28.0.0.0/8
/ipv6 route print detail where dst-address=f2b0::/18
```

确认两条 FakeIP 路由存在，且下一跳正确指向 msf 的 IPv4/IPv6。

返回 [路由器接入总览](router-integration.md)。
