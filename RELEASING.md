# 发布手册

从 v0.4.0 开始，Linux、Unraid、fnOS、macOS 和 Docker 必须由 `main` 上同一个干净 tag checkout 构建。`fnos-fpk`、`codex/docker-runtime` 和 `codex/macosapp` 都不是长期发布分支；不要移动 tag、覆盖历史 Release 或使用 `gh release upload --clobber` 替换已发布资产。

## 1. 发布前检查

```bash
git switch main
git pull --ff-only
go test ./...
npm --prefix web ci
npm --prefix web run check
make macos-app-test
make macos-app-build-debug macos-app-build-release
make macos-app-verify MACOS_CONFIGURATION=Debug
make macos-app-verify MACOS_CONFIGURATION=Release
git status --short
```

最后一条必须无输出。发布版本以 `0.6.0` 这类不带 `v` 的值传给 Make，tag 使用 `v0.6.0`。

## 2. macOS 未签名 Beta 发布策略

当前 macOS App 作为未签名 Beta 发布，不需要 Apple Developer、Developer ID 或公证 Secrets。Release 默认使用 legacy 管理员安装器，而不是 `SMAppService`；资产名称必须包含 `-unsigned`，安装文档和更新日志必须明确说明首次启动需要用户右键“打开”或在“隐私与安全”中手动允许。

签名公证代码保留在非默认的 `MSF_SIGNED_RELEASE` 编译条件、`macos-app-build-signed` 和 `macos-release-assets-signed` 目标中。除非未来明确恢复 Developer ID 发布，否则 GitHub Actions 不得启用这些目标。

## 3. 创建不可变 tag

在与最终候选构建完全相同的 `main` commit 上执行：

```bash
VERSION=0.6.0
git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
```

tag push 会触发两个工作流：

- `Release assets`：分别构建 Linux/Unraid/fnOS 和未签名 macOS Beta 资产，全部成功后一次性创建 GitHub Release。
- `Docker GHCR`：构建并验证 `host-tun`、`macvlan-tun`，再推送 amd64/arm64 多架构镜像。

两个工作流都会确认：

- checkout 工作区干净；
- tag commit 等于 `HEAD` 并可从 `origin/main` 到达；
- 二进制嵌入的 source/tag commit 与 tag 一致；
- Go build metadata 包含 `vcs.modified=false`；
- Docker OCI `org.opencontainers.image.revision` 等于同一 commit。

macOS 工作流还会确认：

- App 与 daemon 都包含 `arm64` 和 `x86_64`；
- App 默认未链接 `ServiceManagement.framework`，Release 使用 legacy Installer；
- Bundle 版本、daemon 来源信息、DMG/ZIP 内容和 SHA-256 验证通过；
- 工作流不读取任何 Apple 签名或公证 Secret。

## 4. 发布资产

GitHub Release 应包含 16 个资产：

- Linux amd64/arm64 tarball 及 SHA-256：4 个。
- Unraid `.txz`、`.plg` 及 SHA-256：4 个。
- fnOS x86/ARM `.fpk` 及 SHA-256：4 个。
- macOS Universal 2 DMG、ZIP 及 SHA-256：4 个。

macOS 资产名称：

```text
MSF-0.6.0-macos-universal-unsigned.dmg
MSF-0.6.0-macos-universal-unsigned.dmg.sha256
MSF-0.6.0-macos-universal-unsigned.zip
MSF-0.6.0-macos-universal-unsigned.zip.sha256
```

fnOS 构建必须使用真正的 `fnpack`；下载失败会中止，绝不生成伪装成 `.fpk` 的 tar.gz fallback。

## 5. 本地发布构建

tag 已存在并指向当前干净 `HEAD` 时，可构建 Linux、Unraid 和 fnOS：

```bash
VERSION=0.6.0
make release-assets VERSION="$VERSION" RELEASE_TAG="v$VERSION"
```

可直接构建未签名 macOS Beta，不需要 Apple 凭据：

```bash
VERSION=0.6.0
make macos-release-assets \
  VERSION="$VERSION" \
  RELEASE_TAG="v$VERSION" \
  MACOS_BUILD_NUMBER=1
```

## 6. 发布后核验

```bash
VERSION=0.6.0
gh release view "v$VERSION" --repo scoltzero/msf --json tagName,targetCommitish,assets
docker buildx imagetools inspect "ghcr.io/scoltzero/msf:v$VERSION"
```

确认 GitHub Release 包含全部 16 个安装资产和 SHA-256，GHCR 同时存在 `v0.6.0` 和 `latest`，且 revision 与 Release tag commit 相同。

下载线上 macOS 资产后再校验摘要：

```bash
shasum -a 256 -c MSF-0.6.0-macos-universal-unsigned.dmg.sha256
shasum -a 256 -c MSF-0.6.0-macos-universal-unsigned.zip.sha256
```

还应在一台未安装过 MSF 的 macOS 15 或更新系统上验证：右键打开 App、管理员授权安装后台、修复后台、卸载后台，以及卸载后 `/Library/Application Support/MSF` 数据保留行为。

## 7. 分支清理

长期只保留 `main`；发布工作流不得向 `main` 自动追加提交，历史发布由不可变 Git tag 和 GitHub Release 保留。

## 8. 失败处理

- 任何测试、来源、dirty、Universal 2、legacy Installer、摘要或黑盒检查失败，都不要创建 GitHub Release。
- 正式 tag 推送前必须完成候选构建；tag 一旦推送不再移动或覆盖。
- 如果已推送 tag 的发布流程失败，修复后使用新的补丁版本，不替换旧 tag 或旧资产。
