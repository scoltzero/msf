<p align="center">
  <img src="logo_motion_mizar/exports/motion/msf-mizar-orbit-weave-transparent.webp" alt="MSF Mizar Logo" width="180">
</p>

<h1 align="center">MSF</h1>

<p align="center">
  <strong>自托管、可审计的 MosDNS + Mihomo 管理平台</strong><br>
  面向合法、授权网络环境，统一管理 DNS 策略、流量转发、规则、组件与运行状态。
</p>

<p align="center">
  <a href="https://github.com/scoltzero/msf/stargazers"><img src="https://img.shields.io/github/stars/scoltzero/msf?style=flat-square&logo=github&label=Stars" alt="GitHub Stars"></a>
  <a href="https://github.com/scoltzero/msf/forks"><img src="https://img.shields.io/github/forks/scoltzero/msf?style=flat-square&logo=github&label=Forks" alt="GitHub Forks"></a>
  <a href="https://github.com/scoltzero/msf/releases"><img src="https://img.shields.io/github/downloads/scoltzero/msf/total?style=flat-square&label=Downloads" alt="GitHub Downloads"></a>
  <a href="https://github.com/scoltzero/msf/releases/latest"><img src="https://img.shields.io/github/v/release/scoltzero/msf?style=flat-square&label=Release" alt="Latest Release"></a>
  <a href="https://discord.gg/Fu3SBgWwRp"><img src="https://dcbadge.limes.pink/api/server/https://discord.gg/Fu3SBgWwRp?style=flat" alt="MSF Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/scoltzero/msf?style=flat-square&label=License" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/scoltzero/msf/releases/latest"><img src="https://img.shields.io/badge/Download-Latest%20Release-0969DA?style=for-the-badge&logo=github&logoColor=white" alt="下载最新版本"></a>
  <a href="docs/install/linux.md"><img src="https://img.shields.io/badge/Documentation-Install%20Guide-334155?style=for-the-badge&logo=readthedocs&logoColor=white" alt="安装文档"></a>
  <a href="https://discord.gg/Fu3SBgWwRp"><img src="https://img.shields.io/badge/Community-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="加入 Discord"></a>
  <a href="#support-msf"><img src="https://img.shields.io/badge/Sponsor-Alipay-1677FF?style=for-the-badge&logo=alipay&logoColor=white" alt="通过支付宝支持 MSF"></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> |
  <a href="docs/faq.md">常见问题</a> |
  <a href="DISCLAIMER.md">免责声明</a> |
  <a href="THIRD_PARTY_NOTICES.md">第三方许可</a>
</p>

> [!IMPORTANT]
> MSF 不提供代理节点、订阅、账号、访问凭据或托管代理服务，也不提供规避网络监管、内容过滤或访问控制的教程。请仅在你拥有或已获充分管理授权的网络中使用，并在部署前阅读[免责声明](DISCLAIMER.md)。

## 为什么选择 MSF

| 能力 | 说明 |
|---|---|
| 一体化控制 | 在一个 WebUI 中管理 MosDNS、Mihomo、规则、连接、日志、组件和系统状态。 |
| 可审计 | 配置、来源、运行状态和更新过程保持可见，不隐藏底层服务行为。 |
| 独立实现 | Go 后端、React WebUI、Mizar 品牌和跨平台控制逻辑均在本仓库持续维护。 |
| 灵活部署 | 覆盖 Linux、Docker、Unraid、fnOS 与 macOS，支持 nftables 或 TUN。 |
| 配置自由 | 支持用户提供的订阅、手动连接、规则源、自定义 Mihomo 配置和离线组件。 |
| 安全边界 | 默认不内置节点、账号或凭据，并提供明确的使用、来源和许可证说明。 |

## 平台支持

| 平台 | 状态 | 安装文档 | 更新与卸载 |
|---|---|---|---|
| Linux tarball / systemd | 稳定 | [Linux 安装](docs/install/linux.md) | `msf update` / `msf uninstall` |
| Docker TUN | 支持 | [Docker 部署](docs/docker.md) | Docker / Compose |
| Unraid PLG | 稳定 | [Unraid 安装](docs/install/unraid-plg.md) | Unraid 插件管理器 |
| fnOS FPK | 支持 | [fnOS 安装](docs/install/fnos-fpk.md) | 飞牛应用中心 / FPK 管理器 |
| macOS 15-26 | 未签名 Beta，TUN only | [macOS 安装](docs/install/macos.md) | App 内安装、修复和卸载后台 |

## 快速开始

1. 从 [Latest Release](https://github.com/scoltzero/msf/releases/latest) 下载与你的平台匹配的安装包。
2. 按对应的[平台安装文档](#平台支持)完成安装。
3. 打开 `http://<服务器IP>:7788`，完成六步初始化向导。
4. 在你拥有或已获授权的路由器上配置 DHCP DNS 与 Fake-IP 静态路由。

<details>
<summary><strong>查看发布资产名称</strong></summary>

| 平台 | 发布资产 |
|---|---|
| Linux x86_64 | `msf-linux-amd64.tar.gz` |
| Linux ARM64 | `msf-linux-arm64.tar.gz` |
| Unraid | `msf.plg` 与 `msf-*-x86_64-1.txz` |
| fnOS x86 / ARM | `msf_*_x86.fpk` / `msf_*_arm.fpk` |
| macOS Universal 2 | `MSF-*-macos-universal-unsigned.dmg` / `.zip` |

所有正式资产均应与同一 Git tag 对应，并附带 SHA-256 校验文件。

</details>

## 架构

<p align="center">
  <img src="docs/png/framework-architecture.svg" alt="MSF 网络与组件架构图" width="920">
</p>

默认链路组合 MosDNS `:53`、Mihomo DNS `:6666`、Fake-IP、TProxy / Redirect 或 TUN。具体模式取决于平台和初始化设置。

## 文档导航

| 分类 | 文档 |
|---|---|
| 路由器接入 | [总览](docs/guide/zh/router-integration.md)<br>[RouterOS](docs/guide/zh/routeros.md)<br>[爱快](docs/guide/zh/ikuai.md)<br>[OpenWrt](docs/guide/zh/openwrt.md)<br>[UniFi](docs/guide/zh/unifi.md) |
| 运行参考 | [目录、端口与文件结构](docs/reference/runtime.md) |
| Docker | [部署说明](docs/docker.md) |
| 插件 | [Cloudflare Redirect](docs/plugins/cloudflare-redirect.md) |
| FAQ | [常见问题](docs/faq.md) |
| 发布 | [RELEASING.md](RELEASING.md) |

> [!NOTE]
> Cloudflare Redirect 是实验功能。效果取决于本机网络、运营商路由、Cloudflare Anycast、IPv6 可达性、域名名单和当前 MosDNS 配置，不保证在所有环境中更快或更稳定。

## 使用边界

- 用户导入的订阅、连接、规则、配置和外部内容由用户或相应第三方提供。
- 使用者应自行核验外部内容的来源、授权、合法性和安全性。
- 项目维护者不提供以规避监管或访问控制为目的的个性化配置、远程部署或故障排查。
- Linux tarball / systemd 可使用 `msf update` 与 `msf uninstall`；其他平台应通过各自包管理器操作。

<details>
<summary><strong>公开参考、跨语言重构与著作权边界</strong></summary>

参考公开可访问的软件源码，学习其功能、处理流程和操作方法，并使用不同编程语言进行独立设计和重新实现，本身不违法，也不当然构成著作权侵权。软件著作权保护具体的程序代码表达，不垄断软件的思想、功能、处理过程、操作方法、兼容接口和由共同上游限定的配置结构。

MSF 在早期开发过程中参考了 [`baozaodetudou/mssb`](https://github.com/baozaodetudou/mssb) 公开代码所呈现的 MosDNS + Mihomo 功能流程，并使用 Go 对管理后端和控制平面进行了跨语言重构、重新设计、优化和扩展。mssb 主要采用 Shell/Python 脚本和配置文件组织安装及运行流程；MSF 当前实现采用独立的 Go 服务架构、数据库模型、HTTP API、配置事务、状态恢复、组件管理和跨平台运行逻辑。

根据当前仓库的逐文件审计，MSF 不包含或分发 mssb 原有的 Shell/Python 程序源码，也未发现对其程序代码进行逐行翻译或直接复制的情况。双方相同的 MosDNS/Mihomo 字段、插件类型、端口、规则格式和必要处理步骤，主要来自共同上游、标准接口、功能约束及表达方式有限的配置结构。相关配置和规则的真实上游来源及许可证已经逐项记录。

因此，就当前 MSF 代码和上述跨语言重构行为而言，参考 mssb 的公开功能实现并不构成对其软件著作权的侵犯，也不因该参考和重构行为本身而违法。该判断仅针对当前已经审计的代码、配置和素材，不扩展到任何未经记录的第三方内容。

MSF 自有代码按照 GNU GPL v3.0 发布。第三方代码、数据和素材继续适用各自的上游许可证，不因收录、调用或随 MSF 分发而被重新许可。

</details>

## 来源与鸣谢

MSF 感谢以下项目和维护者公开其实现、接口、数据或素材。详细文件映射与许可文本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

| 项目 | 对 MSF 的贡献 | 许可或状态 |
|---|---|---|
| [baozaodetudou/mssb](https://github.com/baozaodetudou/mssb) | MosDNS + Mihomo 组合流程的早期公开功能参考；MSF 使用 Go 重新设计并实现管理后端和控制平面。 | 公开可访问参考，不作为 MSF 代码许可来源 |
| [yyysuo/mosdns](https://github.com/yyysuo/mosdns) | MosDNS 核心、扩展插件类型和接口 | GPL-3.0 |
| [yyysuo/firetv](https://github.com/yyysuo/firetv) | 部分 MosDNS 配置和规则材料 | GPL-3.0 |
| [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo) | Mihomo 核心、Controller API 和配置格式 | MIT |
| [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) | GeoIP、Geosite 和规则集数据 | GPL-3.0 |
| [Loyalsoldier/domain-list-custom](https://github.com/Loyalsoldier/domain-list-custom) | 可选远程域名规则源 | MIT |
| [Zephyruso/zashboard](https://github.com/Zephyruso/zashboard) | 连接展示、地球可视化和交互实现基础 | MIT |
| [React Bits](https://github.com/DavidHDev/react-bits) | `GradientWaves` 与 `GlassSurface` | MIT + Commons Clause |
| [Solar System Scope](https://www.solarsystemscope.com/textures/) / [Three.js](https://threejs.org/) / [DB-IP](https://db-ip.com/) | 地球纹理、渲染示例和可选 GeoIP 数据 | CC BY 4.0 / MIT / CC BY 4.0 |
| [nolangz/pixel2motion](https://github.com/nolangz/pixel2motion) | Mizar SVG 拟合与品牌动效制作工具 | MIT |
| [Gzh256](https://github.com/Gzh256) | 多版本测试与验证 | 致谢 |

上述鸣谢仅说明来源和贡献，不表示 MSF 与相关项目存在隶属、授权、合作或官方背书关系。MSF 名称与 Mizar 标识的使用边界见 [BRAND_POLICY.md](BRAND_POLICY.md)。

<a id="support-msf"></a>

## 支持 MSF

如果 MSF 对你有帮助，可以通过 Star、提交 Issue、改进文档、参与测试或赞助维护工作来支持项目。

<p align="center">
  <a href="https://github.com/scoltzero/msf/stargazers"><img src="https://img.shields.io/badge/Support-Give%20a%20Star-181717?style=for-the-badge&logo=github&logoColor=white" alt="为 MSF 点 Star"></a>
  <a href="https://discord.gg/Fu3SBgWwRp"><img src="https://img.shields.io/badge/Support-Join%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="加入 MSF Discord"></a>
</p>

<details>
<summary><strong>支付宝赞助</strong></summary>

<p align="center">暂时不支持赞助，等到后期正式版本 v1.0.0 发布再考虑开启赞助。</p>

</details>

## 开发

```bash
go run ./cmd/msf serve -c ./data -p 7788
```

发布流程见 [RELEASING.md](RELEASING.md)，Unraid 打包说明见 [packaging/unraid/README.md](packaging/unraid/README.md)。

## 许可

- MSF 自有代码：[GNU GPL v3.0](LICENSE)
- 第三方代码、数据与素材：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- MSF 名称与 Mizar 品牌：[BRAND_POLICY.md](BRAND_POLICY.md)

<p align="center">
  <a href="https://linux.do/"><img src="https://ld.xh.do/ld-badge.svg" alt="认可 linux.do"></a>
</p>
