# UniFi（Ubiquiti）接入 msf

在 UniFi 控制器里把 LAN 的 DNS 与 FakeIP 路由引导到 msf 主机。

## 示例环境

| 角色 | IPv4 | IPv6 |
|---|---|---|
| UniFi 网关 | `192.168.1.1` | `fd00::1` |
| msf 主机 | `192.168.1.2` | `fd00::2` |

## 第 1 步：DHCP 下发 DNS

1. 进入 **Settings → Networks**
2. 选择你的 LAN 网络进行编辑
3. 找到 **DHCP → DNS Server** 配置项
4. 将其切换为 **Manual**
5. **DNS Server 1** 填 msf 主机 IP：`192.168.1.2`
6. 只需填这一个 DNS，其余留空

## 第 2 步：FakeIP 静态路由（核心）

在路由/静态路由配置区新增两条：

IPv4：

- **目标网段**：`28.0.0.0/8`
- **下一跳**：`192.168.1.2`
- **类型**：Next Hop（或 Gateway）

IPv6：

- **目标网段**：`f2b0::/18`
- **下一跳**：`fd00::2`
- **类型**：Next Hop（或 Gateway）

> 不同控制器版本里「静态路由 / Static Routes」的位置略有差异，通常在 Settings 的 Routing / Static Routes 一节。

## 验证

客户端执行：

```bash
nslookup google.com   # 结果应落在 28.0.0.0/8
dig AAAA google.com   # 结果应落在 f2b0::/18
```

返回 [路由器接入总览](router-integration.md)。
