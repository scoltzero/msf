# msf — Unraid Community Applications 上架资料

本目录是把 msf 提交到 Unraid 官方 **Community Applications (CA)** 商店所需的资料与说明。
直链安装（把 `.plg` URL 粘进 *Plugins → Install Plugin*）**不需要**这些文件；只有要进 CA 商店、让用户搜索安装时才需要。

## 已经备好的文件

| 文件 | 作用 |
|------|------|
| `../../../LICENSE` | 仓库根的 **GPL-3.0** 全文（CA 要求 OSI 认可协议） |
| `../../../ca_profile.xml` | 仓库根的 **维护者资料**（`<CommunityApplications>`：`Profile/Icon/WebPage`） |
| `ca/msf.xml` | **CA 插件模板**（根元素 `<Plugin>`：`Name/PluginURL/Icon/Overview/Support/Project/Category/Beta`） |
| `../msf.png` | 256×256 列表图标（被 `ca_profile.xml` 与 `ca/msf.xml` 的 `<Icon>` 引用） |
| `../../../msf.plg` | 安装入口，`<PLUGIN>` 已补 `support="https://github.com/scoltzero/msf/issues"` |

> 所有 `<Icon>` / `<PluginURL>` 都用 `raw.githubusercontent.com/scoltzero/msf/main/...` 的 raw 链接，**前提是仓库 public 且这些文件已推到 `main`**。

## 上架前置条件（CA 官方要求）

1. 仓库 **public** 且持续维护 ✅（`scoltzero/msf`，确认已设为 public）
2. 仓库根有 **OSI LICENSE** ✅（GPL-3.0 已放）
3. 有效的 **plugin 包装 XML** ✅（`ca/msf.xml`）
4. **`ca_profile.xml`** 含非空 `<Profile>` ✅（仓库根）
5. **Support 链接** ✅（GitHub Issues）

## 提交步骤

1. 把本次新增/修改的文件 commit 并 push 到 `main`（`LICENSE`、`ca_profile.xml`、`packaging/unraid/ca/msf.xml`、`packaging/unraid/msf.png`、两个 `.plg` 的 `support=`）。
2. 确认 raw 链接可公网访问，例如：
   - `https://raw.githubusercontent.com/scoltzero/msf/main/msf.plg`
   - `https://raw.githubusercontent.com/scoltzero/msf/main/packaging/unraid/msf.png`
3. 打开 **https://ca.unraid.net/submit** → Start Submission，填入仓库地址 `https://github.com/scoltzero/msf`。
4. 让门户扫描仓库（会读 `ca_profile.xml` + 插件 XML），过查重（duplicate sweep）、预览列表。
5. 提交，等待审核。审核通过后用户即可在 CA 里搜索 “msf” 安装。

## 上架后的维护义务（官方明示）

- 随新 Unraid 版本更新保持兼容。
- 在 Support 链接（GitHub Issues）响应支持请求。
- beta/实验版要在 `<Beta>` 标记或版本号上明确标注。

## 可选增强

- 若想用 Unraid 论坛支持帖替代 GitHub Issues：在 forums.unraid.net 发帖后，把帖子 URL 同时填到
  - `ca/msf.xml` 的 `<Support>`
  - `ca_profile.xml` 的 `<Forum>`（取消注释）
  - 根 `msf.plg` 的 `support=` 属性（及 `packaging/unraid/msf.plg.in` 模板）
- 捐赠入口：在 `ca_profile.xml` 取消注释 `<DonateLink>`/`<DonateText>`。
