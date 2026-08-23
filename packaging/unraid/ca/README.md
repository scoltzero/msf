# msf — Unraid Community Applications 上架资料

本目录是把 msf 插件版和 Docker 版提交到 Unraid 官方 **Community Applications (CA)** 商店所需的资料与说明。
直链安装（把 `.plg` URL 粘进 *Plugins → Install Plugin*）**不需要**这些文件；只有要进 CA 商店、让用户搜索安装时才需要。

## 已经备好的文件

| 文件 | 作用 |
|------|------|
| `../../../LICENSE` | 仓库根的 **GPL-3.0** 全文（CA 要求 OSI 认可协议） |
| `../../../ca_profile.xml` | 仓库根的 **维护者资料**（`<CommunityApplications>`：`Profile/Icon/WebPage/Forum`） |
| `ca/msf.xml` | **CA 插件模板**（根元素 `<Plugin>`：`Name/PluginURL/Icon/Overview/Support/Project/Category/Beta`） |
| `ca/msf-docker.xml` | **CA Docker 模板**（根元素 `<Container version="2">`，默认 `br0` + `macvlan-tun`） |
| `../msf.png` | 256×256 列表图标（被 Profile、插件和 Docker 模板引用） |
> CA 模板的 `<PluginURL>` 与插件清单内部的 `pluginURL` 必须完全一致。两者统一使用 `releases/latest/download/msf.plg`，后续更新始终跟随最新正式 Release，避免被 CA 判定为模板地址不匹配。

## 上架前置条件（CA 官方要求）

1. 仓库 **public** 且持续维护 ✅（`scoltzero/msf`，确认已设为 public）
2. 仓库根有 **OSI LICENSE** ✅（GPL-3.0 已放）
3. 有效的 **plugin 包装 XML** ✅（`ca/msf.xml`）
4. 有效的 **Docker Container v2 XML** ✅（`ca/msf-docker.xml`）
5. **`ca_profile.xml`** 含非空 `<Profile>` ✅（仓库根）
6. **Support 链接** ✅（公开的 Unraid Plugin Support 主题）

## Docker 模板默认行为

- 镜像：`ghcr.io/scoltzero/msf:latest`，由 Unraid Docker 页面负责更新。
- 网络：`br0` 自定义 LAN 网络；安装时必须填写未被 DHCP 占用的固定 IPv4。
- 模式：`MSF_DOCKER_NETWORK_MODE=macvlan-tun`，仅使用 TUN，不写宿主机 nftables。
- 权限：仅增加 `NET_ADMIN`、`NET_RAW`，并单独映射 `/dev/net/tun`；不使用 privileged。
- 数据：默认持久化到 `/mnt/user/appdata/msf-docker`，避免与 PLG 默认目录冲突。
- 路由：初始化完成后，路由器 DHCP DNS 与 FakeIP 静态路由应指向容器固定 IP。

## 提交步骤

1. 把本次新增/修改的文件 commit 并 push 到 `main`（包括 `ca_profile.xml`、`packaging/unraid/ca/msf.xml` 和 `packaging/unraid/ca/msf-docker.xml`）。
2. 确认 raw 链接可公网访问，例如：
   - `https://github.com/scoltzero/msf/releases/latest/download/msf.plg`
   - `https://raw.githubusercontent.com/scoltzero/msf/main/packaging/unraid/ca/msf-docker.xml`
   - `https://raw.githubusercontent.com/scoltzero/msf/main/packaging/unraid/msf.png`
3. 打开 **https://ca.unraid.net/submit** → Start Submission，填入仓库地址 `https://github.com/scoltzero/msf`。
4. 先运行 **Validate**，再运行 **Scan**；确认仓库资料、插件条目和 Docker 条目都被识别，再过查重（duplicate sweep）并预览列表。
5. 提交，等待审核。审核通过后用户即可在 CA 里搜索 “msf” 安装。

## 上架后的维护义务（官方明示）

- 随新 Unraid 版本更新保持兼容。
- 在公开的 Unraid Support 主题响应支持请求。
- beta/实验版要在 `<Beta>` 标记或版本号上明确标注。

## 支持入口

- 插件版、Docker 版和仓库 Profile 统一使用公开的 Unraid Plugin Support 主题：
  `https://forums.unraid.net/topic/200222-plugin-msf-mosdns-and-mihomo-management/`
- GitHub Issues 继续用于项目缺陷跟踪，但不再作为 CA 的主 Support 入口。
- 捐赠入口：在 `ca_profile.xml` 取消注释 `<DonateLink>`/`<DonateText>`。
