# msf → Unraid 插件（.plg）开发需求报告

> 编制日期：2026-06-06
> 作者：scoltc
> 适用对象：把现有 `linux/amd64` 产物打包为可在 Unraid 上「通过插件页安装并运行」的 `.plg` 插件
> 结论先行：**Unraid 插件发布物已经完整做好，且早于飞牛就内置在主线里。运行所需源码已全部就绪，无需改源码、无需新建分支、无需写任何权限文件。** 唯一可选的增量工作，是若想上官方 Community Applications 商店时需补 `ca_profile.xml` + OSI LICENSE + 提交审核。

---

## 0. 本报告的研究方法（与飞牛报告同样的两路交叉验证）

1. **路线 A — 本仓库已落地的真实产物**：`packaging/unraid/`（构建脚本、`.plg.in` 模板、`root/` 目录骨架、`.page`、rc 脚本、event 脚本）+ `dist/unraid/`（已产出的 `.txz`/`.plg`/`.sha256`）+ 源码里的 `isUnraidRuntime()` 守卫。
2. **路线 B — 本次独立联网检索**：社区维护的 [plugin-docs](https://github.com/mstrhakr/plugin-docs)、[Unraid 官方 Community Applications 文档](https://docs.unraid.net/community-applications/)、[CA 提交门户 ca.unraid.net/submit](https://ca.unraid.net/submit) 与 submit/help，以及多个真实在产 `.plg`（limetech、Squidly271、dmacias72、itimpi 等）。

> 与飞牛那次不同：飞牛是「先有文档、后验证、踩了一堆 fnpack 坑」；Unraid 这次是「产物早已落地并按 Slackware 惯例编好」，联网检索主要用于**复核现有实现是否符合官方惯例**——结论是**全部符合**。

---

## 1. 现状盘点：已经做完了什么 ✅

| 资产 | 路径 | 状态 |
|------|------|------|
| 构建脚本 | `packaging/unraid/build-unraid.sh` | ✅ 可用，`make unraid` 调用 |
| Make 目标 | `Makefile` → `unraid: package` | ✅ 先编 amd64 二进制，再打包 |
| `.plg` 模板 | `packaging/unraid/msf.plg.in` | ✅ 占位符 `__PLUGIN_VERSION__` 等由脚本 sed 替换 |
| 安装入口 `.plg` | 根目录 `msf.plg`（v0.2.2） | ✅ 指向 `scoltzero/msf` release |
| Slackware 包 | `dist/unraid/msf-0.2.2-x86_64-1.txz` + `.sha256` | ✅ 0.1.8→0.2.2 全部成品在册 |
| WebGUI 设置页 | `root/usr/local/emhttp/plugins/msf/msf.page` | ✅ Settings 菜单，含启停/端口/数据目录表单 |
| rc 服务脚本 | `root/etc/rc.d/rc.msf` | ✅ start/stop/restart/status，含阵列就绪等待 |
| 生命周期事件 | `event/started`、`event/stopping_svcs` | ✅ 随阵列启动/停止自动拉起/收尾 |
| CLI 兼容入口 | `root/usr/local/bin/msf` | ✅ 转发到真实二进制 |
| 源码运行时适配 | `cmd/msf/main.go` / `internal/server/handlers_update.go` | ✅ `isUnraidRuntime()` / `serverIsUnraidRuntime()` 早已内置 |

**一句话：从「构建」到「安装入口」到「运行时守卫」整条链已经闭环，0.2.2 成品包就在 `dist/unraid/`。**

---

## 2. 官方/惯例要求 vs 本仓库实现（路线 B 复核）

### 2.1 `.plg` XML 安装器

官方惯例：`.plg` 是一个 XML 安装器，按文档顺序执行每个 `<FILE>`，负责下载并解压 `.txz`、跑安装/卸载脚本、声明元数据。`<PLUGIN>` 常见属性：`name / author / version / pluginURL / launch / support / icon / min / max`。

| 属性 | 官方含义 | 本仓库 `msf.plg` | 评价 |
|------|----------|----------------------|------|
| `name` | 插件标识 | `msf` | ✅ |
| `author` | 作者 | `luochuhan` | ✅ |
| `version` | 版本 | `0.2.2` | ✅（见 §4 版本号注记） |
| `pluginURL` | 自更新检查地址 | `raw.githubusercontent.com/.../main/msf.plg` | ✅ |
| `launch` | UI 入口 | `Utilities/msf` | ✅ 与 `.page` 的 `Menu="Utilities"` 对应 |
| `icon` | 插件管理页图标 | `network-wired`（Font Awesome） | ✅ |
| `min` | 最低 Unraid 版本 | `6.12.0` | ✅ 合理（6.12 之后为现代基线） |
| `support` | 论坛支持帖 | **未设置** | ⚠️ 直链安装可不填；上 CA 商店**必须**有（见 §5） |
| `max` | 最高兼容版本 | 未设置 | ✅ 可不填（不限上限） |

`<FILE>` 元素也符合惯例：
- 第一个 `<FILE Name=".../&packageFile;" Run="upgradepkg --install-new --reinstall">` 带 `<URL>` + `<SHA256>` → **下载 txz 到 `/boot/config/plugins/` 并校验后安装**。✅ 含 SHA256 完整性校验（很多老插件只用 MD5，这里更稳）。
- 第二个 `<FILE Run="/bin/bash">` 内联脚本 → 建默认 `msf.cfg`、补可执行位、按 `ENABLED` 拉起 rc。✅
- 第三个 `<FILE Run="/bin/bash" Method="remove">` → 停服务、`removepkg`、保留 appdata。✅

### 2.2 Slackware `.txz` 包

官方惯例：包名遵循 `name-version-arch-build` 四段式；内含 `install/slack-desc` 描述；文件树即解压后落盘的绝对路径。

- 包名 `msf-0.2.2-x86_64-1.txz` = `name(msf)-version(0.2.2)-arch(x86_64)-build(1)`。✅ **完全符合四段式**。
- `build-unraid.sh` 用 `tar --uid 0 --gid 0 --uname root --gname root -cJf` 打 `.txz`（xz 压缩、强制 root 属主）。✅ 符合 Slackware 惯例。
- `install/slack-desc` 由脚本生成。✅
- 落盘路径：`/usr/local/emhttp/plugins/msf/`（UI+二进制，RAM 盘，重启丢失靠 `.plg` 重装恢复）、`/etc/rc.d/rc.msf`（服务脚本）、`/usr/local/bin/msf`（CLI）。✅ 与官方「active 在 `/usr/local/emhttp/plugins/`、persistent 在 `/boot/config/plugins/`」模型一致——本插件持久态放 `/boot/config/plugins/msf/msf.cfg` + `/mnt/user/appdata/msf`。✅

### 2.3 `.page` WebGUI 页

官方惯例：`.page` 文件头部是 `Menu=`/`Title=`/`Icon=` 元信息，`---` 之后是 PHP 正文，emhttp 渲染进 WebGUI。

- `msf.page`：`Menu="Utilities"` + `Title="MSF Free"` + `Icon="msf.png"`，PHP 读写 `msf.cfg`、调用 rc 脚本、展示状态、给「Open WebUI」直链。✅ 按官方反馈，将 Utilities 下的图标入口作为插件控制页入口，PNG 图标随包安装到 `/usr/local/emhttp/plugins/msf/`。

### 2.4 event 生命周期脚本

官方支持 `started / stopping_svcs / array_started / disks_mounted …` 等事件钩子（放 `plugins/<name>/event/<事件名>`）。

- 用了 `started`（阵列起来后台拉起 rc）与 `stopping_svcs`（停服务前收尾）。✅ 选型正确，正好覆盖「随阵列启停」。

---

## 3. 源码改动需求 —— 结论：**0 改动**

Unraid 适配在项目早期就写进了主线，运行不需要任何新改动：

- `cmd/msf/main.go:948 isUnraidRuntime()`：检测 `/etc/unraid-version`、`/usr/local/sbin/emhttp`、`/boot/config/plugins` 或 `UNRAID_VERSION` 环境变量。
- 据此在 4 处拦截并给出正确引导（行 466/531/624/689）：在 Unraid 上**禁用** systemd service install/uninstall、禁用 Linux tarball 自更新，提示走 WebGUI 插件页。
- `internal/server/handlers_update.go:333 serverIsUnraidRuntime()`：WebUI 自更新接口同样拦截，提示「Unraid 环境请通过插件管理页面更新」。
- 数据目录、日志（`msf.unraid.log`）等都已就绪。

> 对照飞牛：飞牛当时**需要**新增 `isFnosRuntime()`/`serverIsFnosRuntime()`（仿照的正是这套 Unraid 守卫）。也就是说 Unraid 是「母版」，飞牛是「仿写」。所以 Unraid 这边源码无债可补。

---

## 4. 「需不需要新分支？」 —— 结论：**不需要**

- Unraid 资产从项目初期就**直接长在主线源码树**（`packaging/unraid/` + 主线源码里的守卫），`make unraid` 在任何分支都能构建。
- 飞牛之所以开 `fnos-fpk` 分支，原因有二：(a) 要改源码加 fnOS 守卫与 Makefile 目标；(b) fnpack 有一大套专有、易踩坑的资产需要隔离试验。这两点 Unraid 都不存在——源码已就绪、打包是成熟的 Slackware 惯例。
- 因此**直接在 `main` 上维护 Unraid 发布即可**。发版时只需 `make unraid VERSION=x.y.z …`，把 `.txz`/`.plg` 传到对应 GitHub Release，并把生成的根 `msf.plg` 提交到 `main`（供 `pluginURL` 自更新检查）。

> 版本号注记（路线 B）：Unraid 老插件传统上用日期版本 `YYYY.MM.DD`，CA 的更新检测按版本串比较。本项目用语义版本 `0.2.2` 同样合法且被广泛使用（如 itimpi 等），无需改为日期版本——只要保证**新版本串在 CA 排序下大于旧版**即可触发用户端「有更新」。

---

## 5. 「需不需要权限上的修改？」 —— 结论：**不需要**（比飞牛省事）

- **Unraid 没有飞牛那套 `config/privilege` / `run-as` 机制。** 所有插件与 rc 脚本默认就以 **root** 运行。
- msf 依赖的能力——`nft` 写 TProxy 表、`ip rule/route`、绑定 `:53`/低端口——在 root 下天然可用，**无需任何提权声明或权限文件**。
- 这正是飞牛报告里那个最大坑（`privilege` 必须写成 DSM 血统的 `{"defaults":{"run-as":"root"},...}`）在 Unraid 上**根本不存在**。
- 唯一与「权限」沾边的是脚本可执行位，`.plg` 内联脚本与 `build-unraid.sh` 已用 `chmod 0755` 处理 rc 脚本、event、CLI、二进制。✅

---

## 6. 唯一的可选增量：上官方 Community Applications 商店

直链安装（把 `.plg` URL 发给用户，在 *Plugins → Install Plugin* 粘贴）**现在就能用，无需任何额外工作**。

但若要进官方 **Community Applications（CA）商店**让用户搜索安装，需补以下几项（来自 CA 提交门户与 submit/help）：

1. **公开且持续维护的仓库**（已满足：`scoltzero/msf`，需确保 public）。
2. **仓库根放 OSI 认可的 LICENSE 文件**（⚠️ 需确认本仓库已有合规 LICENSE）。
3. **`ca_profile.xml`**：作者与支持元数据，含非空 `<Profile>` 段。⚠️ **当前没有，需新增**。
4. **插件 wrapper XML / 模板**：提供能被 CA 解析的插件条目；本质是让 CA 能拿到 `.plg` 地址、图标、`support` 帖、描述、分类标签。
5. **`<PLUGIN>` 补 `support` 论坛支持帖链接**（§2.1 当前缺）。CA 上架要求作者在该帖响应支持请求。
6. **图标**：CA 列表用图（建议提供一个可公网访问的 PNG/SVG）；`.page` 入口图标若使用 PNG，需随包安装到 `/usr/local/emhttp/plugins/msf/`。
7. 经 **ca.unraid.net/submit** 提交，过仓库扫描、查重（duplicate sweep）、预览，进入审核。

> 维护义务（官方明示）：上架后需随新 Unraid 版本更新保持兼容、在支持帖响应、beta/实验版要明确标注。

---

## 7. 待办清单（按优先级）

**直链分发（立即可发）——本质无待办，只是发版流程：**
- [ ] `make unraid VERSION=0.2.x UNRAID_VERSION=0.2.x GITHUB_REPO=scoltzero/msf RELEASE_TAG=v0.2.x`
- [ ] `gh release` 上传 `.txz` + 根 `msf.plg`（详见 `packaging/unraid/README.md` 示例）
- [ ] 把生成的根 `msf.plg` 提交到 `main`（让 `pluginURL` 自更新生效）

**上 CA 商店（已基本备齐，2026-06-06 落地）：**
- [x] 仓库根放 OSI LICENSE → **GPL-3.0**（`LICENSE`）
- [x] 新增 `ca_profile.xml`（维护者资料，仓库根）
- [x] 新增 CA 插件列表条目 `packaging/unraid/ca/msf.xml`（`<Containers>`）
- [x] 准备 256×256 列表图标 `packaging/unraid/msf.png`
- [x] `.plg` + `.plg.in` 补 `support=`（GitHub Issues）
- [ ] **commit & push 上述文件到 `main`**，确认 raw 链接公网可达
- [ ] 确认仓库 `scoltzero/msf` 为 public
- [ ] 走 **ca.unraid.net/submit** 填仓库地址、过扫描查重、提交审核
- [ ]（可选）改用 Unraid 论坛支持帖：发帖后把 URL 填进 `ca/msf.xml` `<Support>` + `ca_profile.xml` `<Forum>` + `.plg` `support=`

> 操作细节见 `packaging/unraid/ca/README.md`。

---

## 8. 与飞牛 .fpk 的对照速查

| 维度 | 飞牛 fnOS (.fpk) | Unraid (.plg) |
|------|------------------|---------------|
| 是否已做完 | ✅（branch `fnos-fpk`，真机验证） | ✅（主线，成品到 0.2.2） |
| 需改源码 | 需要（新增 `isFnosRuntime`） | **不需要**（母版早已内置） |
| 需新分支 | 是（`fnos-fpk`，隔离 fnpack 试验） | **否**（主线维护即可） |
| 权限声明 | 必须写 `config/privilege` run-as root（大坑） | **无此机制**，默认 root |
| 进程模型 | cmd/main 自管 PID（systemd-unit 不生效） | rc.d 脚本 + event 钩子（Unraid 原生） |
| 打包工具 | fnpack（专有，多坑） | tar/xz + `.plg`（成熟 Slackware 惯例） |
| 商店上架 | 飞牛应用中心手动安装 | 直链安装即可；CA 商店需补 ca_profile.xml 等 |

---

### 参考来源

- [plugin-docs（社区维护的 Unraid 插件开发文档）](https://github.com/mstrhakr/plugin-docs)
- [Unraid Docs — Community Applications](https://docs.unraid.net/community-applications/)
- [Community Applications 提交门户](https://ca.unraid.net/submit)
- [limetech/Unraid.net.plg（官方插件实例）](https://github.com/limetech/Unraid.net/blob/master/Unraid.net.plg)
- [Squidly271/community.applications.plg](https://github.com/Squidly271/community.applications/blob/master/plugins/community.applications.plg)
- [games-on-whales/unraid-plugin DEVELOPING.md](https://github.com/games-on-whales/unraid-plugin/blob/main/DEVELOPING.md)
