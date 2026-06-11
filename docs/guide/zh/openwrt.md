# OpenWrt 接入 msf

通过静态路由 + DHCP DNS，让 OpenWrt 主路由把流量引导到 msf 主机。下面用 UCI 命令演示（等价操作也可在 LuCI 网页里完成）。

## 示例环境

| 角色 | IPv4 | IPv6 |
|---|---|---|
| OpenWrt 网关 | `192.168.1.1` | `fd00::1` |
| msf 主机 | `192.168.1.2` | `fd00::2` |

## 第 1 步：FakeIP 静态路由（核心）

IPv4：

```bash
uci add network route
uci set network.@route[-1].interface='lan'
uci set network.@route[-1].target='28.0.0.0'
uci set network.@route[-1].netmask='255.0.0.0'
uci set network.@route[-1].gateway='192.168.1.2'
```

IPv6：

```bash
uci add network route6
uci set network.@route6[-1].interface='lan'
uci set network.@route6[-1].target='f2b0::/18'
uci set network.@route6[-1].gateway='fd00::2'
```

提交并生效：

```bash
uci commit network
/etc/init.d/network reload
```

> Telegram 等需要按 IPv6 段直连的服务，可继续用 `route6` 追加对应网段，下一跳同样指向 msf。

## 第 2 步：DHCP 下发 DNS

```bash
uci set dhcp.lan.dhcp_option='6,192.168.1.2'
uci commit dhcp
/etc/init.d/dnsmasq restart
```

`dhcp_option 6` 表示向客户端下发的 DNS 服务器，这里指向 msf 主机。

> LuCI 对应位置：**网络 → 接口 → LAN → DHCP 服务器 → 高级设置 → DHCP 选项**，填 `6,192.168.1.2`。

## 验证

```bash
nslookup google.com 192.168.1.2   # 结果应落在 28.0.0.0/8
dig AAAA google.com @192.168.1.2  # 结果应落在 f2b0::/18
```

IPv4 与 IPv6 两套配置都需要齐全，才能完整工作。

返回 [路由器接入总览](router-integration.md)。
