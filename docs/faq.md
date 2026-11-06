# 常见问题 FAQ

[English version](faq.en.md)

`msf` 作为一款网络代理和 DNS 分流软件，理论上可以尝试自动处理一些端口占用问题。但实际宿主机网络环境往往很复杂，端口背后可能运行着系统 DNS、网关、容器、虚拟化或其它关键服务。为了避免误停服务导致网络异常，建议先由用户确认占用端口的服务是否必要、是否可以关闭，再按实际情况处理。

## 1. 53 端口被占用了怎么办？

先查看宿主机上是谁占用了 53 端口：

```bash
sudo lsof -i:53
```

查看输出里的 `COMMAND` 和 `PID`。如果占用者是 `systemd-resolved`，并且你确认目标宿主机没有依赖它的本地 DNS stub，可以关闭它的 stub listener：

```bash
sudo nano /etc/systemd/resolved.conf
```

找到 `[Resolve]` 段落，添加或取消注释：

```text
DNSStubListener=no
```

保存后重启并确认 53 端口已经释放：

```bash
sudo systemctl restart systemd-resolved
sudo lsof -i:53
```

如果占用者不是 `systemd-resolved`，不要套用上述配置；请根据 `lsof` 输出的服务名称停止对应服务，或修改它的监听端口/地址。

## 2. 修改 FakeIPv6 网段后，个别网页无法访问怎么办？

这通常是 Mihomo 仍保留旧的 FakeIP 域名映射。请先在 MSF 中停止 Mihomo，清除 MSF 用户数据目录下的 Mihomo FakeIP 缓存，再重新启动 Mihomo。

常见缓存文件包括 `configs/mihomo/cache.db`、`configs/mihomo/.cache/cache.db` 和 `configs/mihomo/fakeip.cache`；不同 Mihomo 版本实际生成的文件可能不同。只清理缓存文件，不要删除 Mihomo 配置、订阅或其他用户数据。执行前建议先备份对应文件。

如果重新启动后仍异常，请确认当前 Mihomo 配置中的 `dns.fake-ip-range6` 已更新为新网段，并让客户端重新获取 DNS 结果或清除客户端 DNS 缓存。

## 3. PVE 的 Debian LXC 上，系统诊断提示「本机转发回路存在阻断」怎么办？

测试环境为 Proxmox VE 上的 Debian LXC。容器的 DNS 域和 DNS 服务器都留空时，开启「自动设置 DNS」后，本机 resolver 进不了 MosDNS。系统诊断会报「本机转发回路存在阻断」。

请到 **系统设置 → 系统管理 → 初始化配置**，关闭 **自动设置 DNS**。

要开启这项，先在 PVE 中把该 LXC 的 DNS 服务器设为 `127.0.0.1`，再打开「自动设置 DNS」。DNS 留空时不要开启，否则诊断仍会判定本机转发回路被阻断。
