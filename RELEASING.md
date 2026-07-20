# 发布手册

从 v0.3.9.5 开始，Linux、Unraid、fnOS 和 Docker 必须由同一个干净 tag checkout 构建。不要再从 `fnos-fpk` 分支单独编译，也不要移动 tag、覆盖历史 Release 或使用 `gh release upload --clobber` 替换已发布资产。

## 1. 发布前检查

```bash
git switch main
git pull --ff-only
go test ./...
npm --prefix web ci
npm --prefix web run check
git status --short
```

最后一条必须无输出。发布版本以 `0.3.9.5` 这类不带 `v` 的值传给 Make，tag 使用 `v0.3.9.5`。

## 2. 创建不可变 tag

```bash
VERSION=0.3.9.5
git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
```

tag push 会触发两个工作流：

- `Release assets`：测试并构建 Linux amd64/arm64、Unraid、fnOS x86/arm，核验所有二进制来源，执行 factory reset → TUN 黑盒测试，然后创建 GitHub Release。
- `Docker GHCR`：先构建本地 amd64 镜像并验证 `host-tun`、`macvlan-tun` 与 Docker nft 拒绝，再推送 amd64/arm64 多架构镜像。

两个工作流都会确认：

- checkout 工作区干净；
- tag commit 等于 `HEAD`；
- 二进制嵌入的 source/tag commit 与 tag 一致；
- 非 Docker 二进制的 Go build metadata 包含 `vcs.modified=false`；
- Docker OCI `org.opencontainers.image.revision` 等于同一 commit。

## 3. 本地构建门禁

tag 已存在并指向当前干净 `HEAD` 时，可运行：

```bash
VERSION=0.3.9.5
make release-assets VERSION="$VERSION" RELEASE_TAG="v$VERSION"
```

该命令会生成并验证：

- `msf-linux-amd64.tar.gz` 与 `.sha256`
- `msm-free-linux-amd64.tar.gz` 与 `.sha256`（旧客户端兼容副本）
- `msf-linux-arm64.tar.gz` 与 `.sha256`
- `msm-free-linux-arm64.tar.gz` 与 `.sha256`
- `msf-<version>-x86_64-1.txz` 与 `.sha256`
- `msf.plg` 与 `.sha256`
- `msf_<version>_x86.fpk` 与 `.sha256`
- `msf_<version>_arm.fpk` 与 `.sha256`

fnOS 构建必须使用真正的 `fnpack`；下载失败会中止，绝不再生成伪装成 `.fpk` 的 tar.gz fallback。

## 4. 发布后核验

```bash
VERSION=0.3.9.5
gh release view "v$VERSION" --repo scoltzero/msf --json tagName,targetCommitish,assets
docker buildx imagetools inspect "ghcr.io/scoltzero/msf:v$VERSION"
```

确认 GitHub Release 包含全部安装资产与 SHA-256，GHCR 同时存在 `v<version>` 和 `latest`，且 revision 与 Release tag commit 相同。

如需更新仓库根目录供 Unraid Community Apps 使用的 `msf.plg`，应直接下载本次 Release 中已经验证过的 `msf.plg`，逐字节替换并单独提交；不要重新打包生成另一个 txz 哈希。

## 5. 失败处理

- 任何测试、来源、dirty、摘要或黑盒检查失败，都不要创建/覆盖 Release。
- 如果 tag 尚未产生公开资产，可以删除远端 tag、修复后创建一个新的正确 tag。
- 如果 Release 或 GHCR 已经公开，保留其不可变性并发布下一个补丁版本，不覆盖旧资产。
