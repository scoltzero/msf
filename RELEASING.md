# 发布手册

MSF 只发布 Linux amd64 tarball。发布必须从 `main` 上同一个干净 tag checkout 构建；不要移动 tag、覆盖历史 Release 或使用 `gh release upload --clobber` 替换已发布资产。

## 1. 发布前检查

```bash
git switch main
git pull --ff-only
git status --short
```

最后一条必须无输出。发布版本以 `0.6.0` 这类不带 `v` 的值传给 Make，tag 使用 `v0.6.0`。

## 2. 创建不可变 tag

在与最终候选构建完全相同的 `main` commit 上执行：

```bash
VERSION=0.6.0
git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
```

tag push 会触发 `Release assets` 工作流。工作流会确认 tag 指向当前 `HEAD`、该 commit 可从 `origin/main` 到达，并构建、校验和发布 Linux amd64 资产。

## 3. 发布资产

Release 只包含以下文件：

```text
msf-linux-amd64.tar.gz
msf-linux-amd64.tar.gz.sha256
```

校验脚本会检查 SHA-256、ELF amd64 架构、二进制嵌入的 Git commit、tag 和干净工作区标识。

## 4. 本地构建

tag 已存在并指向当前干净 `HEAD` 时：

```bash
make release-assets VERSION=0.6.0 RELEASE_TAG=v0.6.0
```

产物位于 `dist/`。安装说明见 [docs/install/linux.md](docs/install/linux.md)。
