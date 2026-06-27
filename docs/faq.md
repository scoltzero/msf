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
