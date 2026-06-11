# 发布手册（手动打包 / Manual Release）

本项目**不使用 GitHub Actions**，发布全部手动完成。以下命令均为已验证可用的流程。把 `VERSION` 替换为本次版本（示例用 `0.3.0`，tag 用 `v0.3.0`）。

## 0. 前置

- 在干净的 `main` 工作区操作（`git status` 干净）。
- 已安装 Go、Node 22、`gh`（已登录 `scoltzero/msf` 推送权限）。
- 产物输出在 `dist/`（已 gitignore）。

## ⚠️ 最重要的一条规则

**Linux（amd64/arm64）和 Unraid 必须在 `main` 上编译；fnOS `.fpk` 才在 `fnos-fpk` 上编译。**

原因：`fnos-fpk` = `main` + fnOS 专属代码（`cmd/msf/main.go`、`handlers_update.go` 等会被编进二进制）。在 `fnos-fpk` 上跑 `make package`/`make unraid` 会把 fnOS 代码混进 Linux/Unraid 二进制。
另外 `make unraid` 和 `make fnos` 都会**顺带重建 amd64 tarball**——所以谁最后跑，`dist/msf-linux-amd64.tar.gz` 就是谁的。**先在 main 出全部 Linux/Unraid 资产，最后才切 fnos-fpk 只出 fpk，且不要从 fnos-fpk 重传 amd64。**

---

## 1. 在 `main` 上构建 Linux + Unraid

```bash
git switch main
VERSION=0.3.0

# amd64
make package VERSION=$VERSION GOOS=linux GOARCH=amd64

# arm64
make package VERSION=$VERSION GOOS=linux GOARCH=arm64

# Unraid（会重建 amd64 作为依赖，并把 txz 哈希写进 root msf.plg）
make unraid VERSION=$VERSION UNRAID_VERSION=$VERSION GITHUB_REPO=scoltzero/msf RELEASE_TAG=v$VERSION GOOS=linux GOARCH=amd64
```

### 1a. 生成旧名兼容副本 + 校验和（在所有 make 跑完之后）

> `msm-free-*.tar.gz` 是给 **v0.2.2 旧客户端**的逐字节副本（它们硬编码旧资源名，靠仓库重定向下载）。**必须**有，且必须与新名逐字节相同。

```bash
# amd64（注意：要在 make unraid 之后再生成，因为它重建过 amd64）
cp -f dist/msf-linux-amd64.tar.gz dist/msm-free-linux-amd64.tar.gz
cmp dist/msf-linux-amd64.tar.gz dist/msm-free-linux-amd64.tar.gz   # 必须无输出
shasum -a 256 dist/msf-linux-amd64.tar.gz      > dist/msf-linux-amd64.tar.gz.sha256
shasum -a 256 dist/msm-free-linux-amd64.tar.gz > dist/msm-free-linux-amd64.tar.gz.sha256

# arm64
cp -f dist/msf-linux-arm64.tar.gz dist/msm-free-linux-arm64.tar.gz
cmp dist/msf-linux-arm64.tar.gz dist/msm-free-linux-arm64.tar.gz   # 必须无输出
shasum -a 256 dist/msf-linux-arm64.tar.gz      > dist/msf-linux-arm64.tar.gz.sha256
shasum -a 256 dist/msm-free-linux-arm64.tar.gz > dist/msm-free-linux-arm64.tar.gz.sha256

# Unraid
shasum -a 256 dist/unraid/msf-$VERSION-x86_64-1.txz > dist/unraid/msf-$VERSION-x86_64-1.txz.sha256
shasum -a 256 dist/unraid/msf.plg                   > dist/unraid/msf.plg.sha256
```

### 1b. 提交 root `msf.plg`（如有变化）

`make unraid` 会用本次 `.txz` 的哈希重写 root `msf.plg`（CA/raw 安装入口必须与已发布的 `.txz` 一致）：

```bash
git add msf.plg && git commit -m "Update Unraid manifest hash for v$VERSION txz" && git push origin main
```

---

## 2. 在 `fnos-fpk` 上构建 fnOS `.fpk`

```bash
git switch fnos-fpk
git merge main          # 把 main 最新代码并进来；正常是干净自动合并
make fnos VERSION=$VERSION GOOS=linux GOARCH=amd64
shasum -a 256 dist/msf_${VERSION}_x86.fpk > dist/msf_${VERSION}_x86.fpk.sha256
git switch main         # 出完包切回 main
```

> `make fnos` 会自动下载 fnpack（飞牛 CDN）；网络不通会退化成无效 tar.gz，注意看输出 `DONE: dist/msf_..._x86.fpk` 才算成功。
> 抽查：`tar -xzf dist/msf_${VERSION}_x86.fpk -C /tmp/x && grep -E 'appname|display_name' /tmp/x/manifest` 应为 `appname = msf` / `display_name = MSF Free`。

---

## 3. 发布 / 覆盖上传到 GitHub Release

tag 用 `v$VERSION`。**首次发布**用 `create`，**补传/覆盖**用 `upload --clobber`。

```bash
VERSION=0.3.0
# 首次创建（如该 tag 还没 release）
gh release create v$VERSION --repo scoltzero/msf --title v$VERSION --notes-file CHANGELOG-or-notes.md \
  dist/msf-linux-amd64.tar.gz dist/msf-linux-amd64.tar.gz.sha256 \
  dist/msm-free-linux-amd64.tar.gz dist/msm-free-linux-amd64.tar.gz.sha256 \
  dist/msf-linux-arm64.tar.gz dist/msf-linux-arm64.tar.gz.sha256 \
  dist/msm-free-linux-arm64.tar.gz dist/msm-free-linux-arm64.tar.gz.sha256 \
  dist/unraid/msf-$VERSION-x86_64-1.txz dist/unraid/msf-$VERSION-x86_64-1.txz.sha256 \
  dist/unraid/msf.plg dist/unraid/msf.plg.sha256 \
  dist/msf_${VERSION}_x86.fpk dist/msf_${VERSION}_x86.fpk.sha256

# 已存在则覆盖上传（把 create 换成 upload ... --clobber）
gh release upload v$VERSION --repo scoltzero/msf --clobber \
  dist/msf-linux-amd64.tar.gz ... （同上资产列表）
```

### 验证发布端 digest 与本地一致

```bash
gh release view v$VERSION --repo scoltzero/msf --json assets \
  --jq '.assets[] | "\(.name)  \(.digest)"'
# 旧名兼容副本与新名应同 digest（amd64/arm64）
```

旧客户端可达性（v0.2.2 升级链路）：旧仓库名 `scoltzero/msm-free` 经 GitHub 重定向到 `scoltzero/msf`，下载 `msm-free-linux-amd64.tar.gz` 会 301/302 到资产。

---

## 4. 关于 git tag

- 现在没有 CI，**移动/强推 tag 不会触发任何自动流程**，但建议 tag 仍指向本次发布的 main 提交，保证「tag 源码 = 已发布二进制源码」。
- 创建：`git tag -a v$VERSION <commit> -m "v$VERSION" && git push origin v$VERSION`
- Linux/Unraid 二进制源码以 `main` 上该提交为准；fnOS `.fpk` 源码 = 该提交 + fnOS 专属代码（`fnos-fpk`），属正常差异。

---

## 速查清单

- [ ] `main` 工作区干净，`VERSION` 设好
- [ ] `make package` amd64 + arm64（main）
- [ ] `make unraid`（main，会重建 amd64 + 改 root msf.plg）
- [ ] 生成旧名副本 + `cmp` 校验 + `shasum`（amd64/arm64/txz/plg）
- [ ] 提交并推送 root `msf.plg`
- [ ] `fnos-fpk`：`git merge main` → `make fnos` → fpk sha → 切回 main
- [ ] `gh release create/upload --clobber` 全部资产
- [ ] `gh release view` 核对 digest（新旧名同 digest）
