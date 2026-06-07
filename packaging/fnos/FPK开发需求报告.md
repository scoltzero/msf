# msf → 飞牛 fnOS .fpk 应用开发需求报告

> 编制日期：2026-06-06
> 作者：scoltc
> 适用对象：把现有 `linux/amd64` 产物打包为可在飞牛应用中心「手动安装并运行」的 `.fpk` 应用
> 结论先行：**核心 Go 二进制 + WebUI 无需改源码即可在 fnOS 上跑起来（前提是以 root 运行）；但要做到「干净、可上架、可被应用中心正常管理」的体验，需要少量源码适配，建议新建 `fnos-fpk` 分支。**

---

## 0. 本报告的研究方法（两次独立比对）

本报告基于两路独立信息源交叉验证：

1. **路线 A — 你提供的文档**：`~/Downloads/fnos-go-app-fpk-packaging-guide.md`
2. **路线 B — 我本次独立联网检索**：飞牛官方开发者站 `developer.fnnas.com`（framework / manifest / fnpack 三页）、社区实战（node_exporter 教程）、以及 **真实在产的第三方 fpk 仓库 `conversun/fnos-apps`（115+ 应用）中的真实 `manifest / privilege / resource / cmd/main / *.sc` 文件**。

> 关键价值：路线 B 拿到了**真实安装包里的实际文件内容**，因此能纠正路线 A 中凭推测写出的错误字段。

---

## 1. 两次结果比对（路线 A vs 路线 B）

### 1.1 结论一致、可直接采信的部分 ✅

| 主题 | 路线 A（你的文档） | 路线 B（官方+真实包） | 结论 |
|------|------|------|------|
| fnOS 架构 | 仅 x86_64 / amd64 | 一致（manifest `platform=x86`，也支持 `arm`/`all`） | ✅ amd64 产物符合 |
| 编译要求 | `CGO_ENABLED=0 GOOS=linux GOARCH=amd64` | 一致（静态二进制最稳） | ✅ 你的 Makefile 已经是这样编的 |
| 目录骨架 | cmd/ config/ wizard/ + manifest + ICON | 官方 framework 页完全一致 | ✅ |
| `cmd/main` 子命令 | start/stop/status | 官方一致 | ✅ |
| **status 退出码** | 运行=0，未运行=**3**（不是 1） | 官方表格一致；真实 `cmd/main` 也是 `exit 3` | ✅ 关键点，已验证 |
| start/stop 退出码 | 成功=0，失败=1 | 一致 | ✅ |
| manifest 必填字段 | appname/version/display_name/source… | 官方一致；真实包额外常带 `checksum`/`distributor` | ✅ |
| `platform` 取代废弃的 `arch` | 是 | 官方确认 `arch` 已废弃 | ✅ |
| 注入环境变量 | `TRIM_APPDEST` / `TRIM_TEMP_LOGFILE` | 官方+真实包确认，并补充 `TRIM_PKGVAR/TRIM_PKGETC/TRIM_SERVICE_PORT/TRIM_USERNAME` | ✅ 路线 A 偏少，见 §3 |
| 安装/测试方式 | 应用中心手动安装 / `appcenter-cli install-fpk` / `install-local` | 一致 | ✅ |
| 打包工具 | `fnpack create/build` | 官方一致；社区另有 CI 脚本 `build-fpk.sh` 直接压包 | ✅ |

### 1.2 路线 A 写**错**、必须以路线 B 为准的部分 ❌（最重要）

> 你文档里 §6 的 `privilege` / `resource` 两段 JSON 是**凭推测写的，与真实格式不符**。如果照抄会装不上或权限错乱。

**`config/privilege` 真实格式**（取自 `conversun/fnos-apps` 真实在产包，这是 DSM/群晖 SPK 血统的 schema）：

```jsonc
// 你文档写的（错误）：{ "network": true, "run_as_root": false }
// 真实格式（qBittorrent / Transmission，普通权限）：
{
    "defaults": { "run-as": "package" },
    "username": "msf",
    "groupname": "msf"
}
// 真实格式（Jellyfin，需要访问设备组）：
{
    "defaults": { "run-as": "user" },
    "username": "jellyfin",
    "groupname": "jellyfin",
    "join-groups": ["video","render"]
}
```

- 权限模型核心字段是 **`defaults.run-as`**，取值为 `package`（独立包用户，最低权限）/ `user` / **`root`**（特权）。
- **没有** `network` / `run_as_root` 这种字段。要 root，就是 `"run-as": "root"`。

**`config/resource` 真实格式**：

```jsonc
// 你文档写的（错误）：{ "cpu": true, "memory": true, "disk": true }
// 真实格式：
{
    "port-config": { "protocol-file": "msf.sc" },   // 端口/防火墙转发声明，指向同名 .sc 文件
    "data-share": {                                       // 申请共享文件夹及读写权限
        "shares": [ { "name": "msf", "permission": { "rw": ["msf"] } } ]
    },
    "systemd-unit": { },                                  // 关键能力：声明由 systemd 托管（见 §4）
    "docker-project": { }                                 // 仅 Docker 型应用用
}
```

**`*.sc` 端口转发文件**（路线 A 完全没提，但真实包都有，用于在防火墙/端口转发里登记服务端口）：

```ini
[msf]
title="msf"
desc="msf Web UI"
port_forward="yes"
src.ports="7777/tcp"
dst.ports="7777/tcp"
```

### 1.3 两份文档都**没讲清**、但对本项目最致命的部分 ⚠️

| 问题 | 官方文档 | 真实包给出的答案 |
|------|----------|------------------|
| 应用能不能以 **root** 跑？ | 未明说 | **能**：`privilege.defaults.run-as = "root"`；node_exporter 实战用 `install_type=root` |
| 能不能做 **nftables / NET_ADMIN / 绑定 :53** 这类特权网络操作？ | 完全未提 | 真实包里没有同类样本（多为容器/普通服务）。**属于未知风险，必须真机验证**（见 §6 风险表 R1） |
| 默认是不是沙箱化？ | 未提 | 默认 `run-as: package` 是独立低权用户、目录被符号链接隔离（etc/var/tmp/home 各自指向 `@appconf/@appdata/...`） |

---

## 2. 本项目（msf）的「特权画像」——为什么这是难点

`msf` 不是普通 Web 服务，而是一个**系统级网络管控面板**。我已通读源码确认它在运行时会：

| 行为 | 代码位置 | 对 fnOS 的含义 |
|------|----------|----------------|
| 执行 `nft -f` 加载/删除 nftables 表 `inet msf` | `internal/server/handlers_system.go:447/491/519` | **需 root + NET_ADMIN** |
| TProxy(7896)/Redirect(7877) + `meta mark set 1 tproxy` | `internal/server/configgen.go:480-511` | **需 NET_ADMIN，且依赖内核 nft tproxy 模块** |
| MosDNS 监听 **:53**（特权端口 <1024） | 模板/README | **需 root 或 CAP_NET_BIND_SERVICE，且与 fnOS 自带 DNS 可能冲突** |
| 拉起 mosdns / mihomo 子进程（supervisor 风格） | `internal/server/process.go:106` | 需要可执行权限与稳定工作目录 |
| 运行时下载并校验 mosdns/mihomo/zashboard 核心 | README / setup | **需出网权限**；fnOS 沙箱目录可写性需验证 |
| 通过 `systemctl restart/stop/is-active` 管理自身守护 | `internal/server/handlers_daemon.go:14-118`（硬编码 `msf.service`） | fnOS 下服务不叫这个名字 → **WebUI 的「重启/停止/状态」会失灵** |
| `msf status / logs / restart` 调 `systemctl` / `journalctl -u msf` | `cmd/msf/main.go:334/381` | 同上，CLI 这几条会失灵 |
| `msf update` 自更新：下载 tar→替换 `/usr/local/bin`→`systemctl restart` | `cmd/msf/main.go:524+` | **与 fpk 生命周期冲突**，应在 fnOS 下禁用 |
| 默认数据目录 `/opt/msf`（root 时） | `cmd/msf/main.go:238-246` | 应改放到 `$TRIM_PKGVAR`，但**已支持 `MSF_DATA_DIR` 环境变量覆盖**，无需改码 |

---

## 3. 系统注入环境变量（路线 B 补全）

`cmd/*` 与 `wizard/*` 脚本运行时可用：

| 变量 | 含义 | 本项目用途 |
|------|------|-----------|
| `TRIM_APPDEST` | 应用安装根目录（符号链接） | `cmd/main` 里定位二进制 `${TRIM_APPDEST}/app/msf` |
| `TRIM_PKGVAR` | 可写数据目录（→ `@appdata/msf`） | **传给 `--config` / `MSF_DATA_DIR`** 作为数据目录 |
| `TRIM_PKGETC` | 配置目录（→ `@appconf/msf`） | 存放 app.yaml 等（可选） |
| `TRIM_SERVICE_PORT` | manifest `service_port` 的值 | 传给 `--port` |
| `TRIM_TEMP_LOGFILE` | 错误日志文件（V1.1.8+） | start 失败时写入，便于用户在 UI 看到原因 |
| `TRIM_USERNAME` | 触发操作的用户名 | 一般用不到 |

---

## 4. 关键发现：fnOS 原生支持 systemd 托管（对本项目极有利）

真实 `resource` 文件普遍带 `"systemd-unit": {}`。这说明 **fnOS 可以用 systemd 托管应用进程**——这与 `msf` 现有的 systemd 集成天然契合。

由此引出两条可选实现路线：

- **路线甲（cmd/main 自管，推荐先做）**：`cmd/main` 用 `nohup` 拉起 `serve`，自己实现 start/stop/status。改动最小、最可控。
- **路线乙（声明 systemd-unit）**：在 `resource` 声明 systemd 单元，让 fnOS 注册一个真实 systemd 服务。好处是 `handlers_daemon.go` 里硬编码的 `systemctl ... msf` **有可能直接复用**（若单元名对齐为 `msf`），WebUI 的重启/停止/状态可少改甚至不改。代价是与 fnOS 单元命名约定耦合，需真机确认单元名。

> 建议：**先用路线甲跑通 MVP，再评估是否切路线乙以恢复 WebUI 守护管理按钮。**

---

## 5. 需不需要改源码？—— 分级结论

### 5.1 不需要改源码就能工作的部分 ✅

- Go 二进制本体、WebUI、初始化向导、MosDNS/Mihomo 配置生成与子进程托管——**只要以 root 运行、数据目录可写、能出网**，逻辑与在普通 Linux/Unraid 上一致。
- 数据目录：已支持 `MSF_DATA_DIR` 环境变量与 `--config` 参数覆盖，`cmd/main` 传 `$TRIM_PKGVAR` 即可，**无需改码**。
- 端口/host：`serve --host 0.0.0.0 --port $TRIM_SERVICE_PORT`，**无需改码**。

### 5.2 建议改源码（否则体验有缺陷）——这正是「新建分支」的理由 ⚠️

| # | 改动 | 原因 | 建议做法 | 严重度 |
|---|------|------|----------|--------|
| C1 | 新增 `isFnosRuntime()` 运行时探测 | 代码已有 `isUnraidRuntime()` 同款模式，照抄即可（探测 `TRIM_APPDEST` 或 `/var/apps`） | `cmd/msf/main.go` | 中 |
| C2 | fnOS 下**禁用/改写 `msf update` 自更新** | 自更新会替换 `/usr/local/bin` 并 `systemctl restart`，与 fpk 生命周期冲突，更新应交给应用中心 | 复用 `isUnraidRuntime` 的 guard 写法（`updateRuntime` 已有此类分支） | **高** |
| C3 | `handlers_daemon.go` 的 `systemctl/journalctl` 硬编码 `msf.service` 适配 | fnOS 下服务名/管理方式不同，否则 WebUI「重启/停止/状态」「日志」按钮失灵 | 路线乙对齐单元名复用；或 fnOS 分支下改走 `cmd/main` | 中 |
| C4 | `msf status/logs/restart` CLI 的 systemd/journalctl 分支 | 同 C3，CLI 体验 | 同 C3 | 低 |
| C5 | 端口 53 与 fnOS 自带 DNS 冲突的探测与提示 | fnOS 基于 Debian，可能占用 :53 | doctor/向导加检测与提示（也可纯打包侧处理） | 中 |

> 这些改动都很局部，且**项目已有 `isUnraidRuntime()` 这一「按运行环境分叉」的成熟范式**，新增 fnOS 分叉是顺理成章的扩展，不会侵入核心逻辑。

### 5.3 结论：要不要新建分支？

**要。** 建议新建 `fnos-fpk` 分支，原因：

1. 需要新增一整套打包资产 `packaging/fnos/`（与现有 unraid/systemd 并列），不污染 main。
2. 需要 C1–C5 的源码适配（环境探测 + 自更新 guard + 守护管理分叉）。
3. 需要新增 Makefile 目标 `fnos`，产出 `.fpk`。
4. 真机联调（特权 nftables/TProxy 能否在 fnOS 包用户下生效）有不确定性，隔离在分支上更安全。

---

## 6. 风险清单（必须真机验证的未知项）

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| **R1** | fnOS 即使 `run-as: root`，是否仍对包做 namespace/cgroup 限制而**阻断 NET_ADMIN / nft tproxy** | 致命：透明代理整条链路不可用 | 先在 SSH 里手动 `nft -f` + 起 tproxy 验证内核与权限；再装 fpk 验证包内是否同样可行 |
| R2 | fnOS 占用 **:53** | MosDNS 起不来 | 检测并提示；或允许自定义 DNS 入口端口 |
| R3 | 沙箱目录可写性/可执行性（下载的核心放 `@appdata` 能否 `chmod +x` 执行） | 组件安装失败 | 把核心放 `TRIM_PKGVAR` 并确认 noexec 未开启 |
| R4 | nft tproxy 内核模块（`nft_tproxy`/`xt_TPROXY`）是否随 fnOS 6.12 内核提供 | 透明代理失效 | `modprobe` 探测；doctor 输出 |
| R5 | 应用中心对「修改全局防火墙/路由」的特权应用是否允许上架/手动安装 | 上架受阻 | 先走「手动安装」分发，不强求官方商店 |

---

## 7. 交付物清单（`packaging/fnos/` 目标结构）

```
packaging/fnos/
├── build-fpk.sh                 # 新增：组装 + fnpack build（或直接打 tar）
├── manifest.in                  # 模板，构建时注入 version/checksum
├── ICON.PNG / ICON_256.PNG      # 复用现有 logo 生成 64/256
├── msf.sc                  # 端口转发声明（7777/tcp）
├── config/
│   ├── privilege                # {"defaults":{"run-as":"root"}, "username":"msf", "groupname":"msf"}
│   └── resource                 # {"port-config":{"protocol-file":"msf.sc"}, "systemd-unit":{}, ...}
├── cmd/
│   ├── main                     # start/stop/status（exit 0/0/3），用 $TRIM_APPDEST/$TRIM_PKGVAR
│   ├── install_init / install_callback
│   ├── uninstall_init / uninstall_callback
│   └── upgrade_init / upgrade_callback
├── wizard/
│   ├── install                  # 可选：让用户填端口/管理员密码
│   ├── uninstall
│   └── config
└── app/
    ├── msf                 # CGO_ENABLED=0 amd64 二进制（来自 dist/）
    └── ui/                      # 如走桌面入口
```

`cmd/main` 核心（路线甲）草案：

```bash
#!/bin/bash
BIN="${TRIM_APPDEST}/app/msf"
DATA="${TRIM_PKGVAR}"
PORT="${TRIM_SERVICE_PORT:-7777}"
export MSF_DATA_DIR="${DATA}"
case "$1" in
  start)  pgrep -x msf >/dev/null && exit 0
          nohup "${BIN}" serve --config "${DATA}" --host 0.0.0.0 --port "${PORT}" \
              >> "${DATA}/msf.log" 2>&1 &
          exit $? ;;
  stop)   "${BIN}" stop --config "${DATA}" --timeout 20s --force >/dev/null 2>&1
          pkill -9 -x msf; exit 0 ;;
  status) pgrep -x msf >/dev/null && exit 0 || exit 3 ;;
  *)      exit 1 ;;
esac
```

---

## 8. 执行计划（建议顺序）

1. **真机预验证（R1，最先做，决定可行性）**：SSH 进 fnOS，手动跑 `nft -f` + tproxy + 绑定 :53，确认内核/权限放行。**不通则整个透明代理特性需重设计。**
2. 新建分支 `fnos-fpk`。
3. 源码适配 C1（`isFnosRuntime`）、C2（自更新 guard）——优先，低风险。
4. 落地 `packaging/fnos/`（§7），先走路线甲（cmd/main 自管）。
5. `make fnos` 产出 `.fpk`；用 `appcenter-cli install-local` 真机联调。
6. 验证 WebUI 守护「重启/停止/状态/日志」是否可用；不行则做 C3/C4（或切路线乙）。
7. 完善向导（端口、管理员密码、:53 冲突提示 C5）。
8. 出 `.fpk`，走应用中心手动安装分发。

---

## 9. 参考来源

**官方**
- https://developer.fnnas.com/docs/core-concepts/framework （目录结构、cmd/main、env 变量）
- https://developer.fnnas.com/docs/core-concepts/manifest （manifest 字段、`install_type=root`、`platform`）
- https://developer.fnnas.com/docs/cli/fnpack （打包校验、`fnpack create/build`）

**真实在产 fpk（用于纠正 privilege/resource 真实格式）**
- https://github.com/conversun/fnos-apps — `apps/*/fnos/config/privilege`、`resource`、`*.sc`、`shared/cmd/main`
- https://greendamtan.github.io/2025/05/20200129_fnos_appcenter/ — node_exporter 实战（`install_type=root`、cmd/main 模板）

**你的原始文档**
- `~/Downloads/fnos-go-app-fpk-packaging-guide.md`（结构/流程正确；§6 privilege/resource JSON 有误，已在 §1.2 纠正）
