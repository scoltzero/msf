# FAQ

[中文版本](faq.md)

As a network proxy and DNS split-routing tool, `msf` can theoretically try to resolve some port conflicts automatically. In practice, host networking is often complex, and an occupied port may belong to system DNS, a gateway service, containers, virtualization, or another critical service. To avoid breaking the host network by stopping the wrong service, users should first confirm what is using the port, whether that service is required, and whether it can be safely disabled.

## 1. What should I do if port 53 is already occupied?

First check which process is using port 53 on the host:

```bash
sudo lsof -i:53
```

Check the `COMMAND` and `PID` columns. If the process is `systemd-resolved`, and you have confirmed that the target host does not depend on its local DNS stub, disable the stub listener:

```bash
sudo nano /etc/systemd/resolved.conf
```

Find the `[Resolve]` section, then add or uncomment:

```text
DNSStubListener=no
```

Save the file, restart the service, and confirm that port 53 has been released:

```bash
sudo systemctl restart systemd-resolved
sudo lsof -i:53
```

If the process is not `systemd-resolved`, do not apply the setting above. Stop the service shown by `lsof`, or change that service's listen port/address.
