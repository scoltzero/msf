# Linux MosDNS 发布包与流量监控实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（\`- [ ]\`）语法来跟踪进度。

**目标：** 将 MSF 改为 Linux amd64 专用，使用完整 MosDNS ZIP 包安装 MosDNS 与流量代理，并在既有 MosDNS 导航下增加受鉴权保护的设备流量监控页面。

**架构：** 后端新增发布包安装器，接收上传文件或任意 HTTP(S) URL，验证并原子部署 ZIP 内的 \`cus\` 与 \`monitor\` 目录。服务管理器把 \`mosdns\` 和 \`mosdns-traffic-agent\` 作为同一生命周期单元；WebUI 只调用 MSF 同源 API，不直接访问 9099/9199。

**技术栈：** Go 1.24、标准库 HTTP/ZIP/ELF、SQLite、React 19、TypeScript、Vite、Vitest。

**执行约束：** 用户要求本次仅修改代码与配置，并进行静态审查；不新增测试、不运行测试、不执行构建。计划中的测试步骤保留为后续人工验证参考，但本次执行跳过。

---

## 文件结构

- 创建：\`internal/server/mosdns_bundle.go\`，安装和回滚完整 MosDNS 发布包。
- 创建：\`internal/server/mosdns_bundle_test.go\`，发布包安装和错误路径测试。
- 创建：\`internal/server/mosdns_traffic.go\`，本地流量代理客户端和 HTTP 处理器。
- 创建：\`internal/server/mosdns_traffic_test.go\`，流量 API 和代理失败测试。
- 修改：\`internal/server/process.go\`、\`internal/server/runtime.go\`、\`internal/server/runtime_templates.go\`，成对管理两个运行进程且不覆盖发布包配置。
- 修改：\`internal/server/handlers_mosdns.go\`、\`internal/server/handlers_setup.go\`、\`internal/server/component_upload.go\`，接收 ZIP/URL 并注册流量接口。
- 修改：\`internal/server/paths.go\`、\`internal/server/mosdns_compat.go\`，将既有 MSF MosDNS API 映射到发布包目录。
- 修改：\`web/src/pages/SetupPage.tsx\`、\`web/src/pages/setup/setup-validation.ts\`，安装包输入替换自动下载。
- 创建：\`web/src/app/mosdns/traffic/page.tsx\` 和 \`web/src/app/mosdns/traffic/traffic.test.tsx\`。
- 修改：\`web/src/App.tsx\`、\`web/src/lib/dashboard-data.ts\`、\`web/src/components/MobileNav.tsx\`，注册导航与路由。
- 修改/删除：\`Makefile\`、\`README.md\`、\`README.en.md\`、\`RELEASING.md\`、\`.github/\`、\`packaging/\`、\`scripts/\`、Docker/macOS/Unraid/fnOS 文件，收敛至 Linux amd64。

### 任务 1：完整发布包安装器

**文件：**
- 创建：\`internal/server/mosdns_bundle.go\`
- 创建：\`internal/server/mosdns_bundle_test.go\`

- [ ] **步骤 1：编写失败测试**

\`\`\`go
func TestInstallMosDNSBundleInstallsPairedRuntime(t *testing.T) {
    app := newTestApp(t)
    archive := writeMosDNSBundleFixture(t, validMosDNSBundleFiles(t))

    if err := app.installMosDNSBundle(context.Background(), archive, "eth0"); err != nil {
        t.Fatal(err)
    }

    mustExist(t, filepath.Join(app.DataDir, "data/binaries/mosdns/mosdns"))
    mustExist(t, filepath.Join(app.DataDir, "data/binaries/mosdns-traffic-agent/mosdns-traffic-agent"))
    mustExist(t, filepath.Join(app.DataDir, "configs/mosdns/config_custom.yaml"))
}
\`\`\`

- [ ] **步骤 2：运行测试验证失败**

运行：\`go test ./internal/server -run TestInstallMosDNSBundleInstallsPairedRuntime -count=1\`

预期：FAIL，\`installMosDNSBundle\` 未定义。

- [ ] **步骤 3：实现最小安装器**

在 \`mosdns_bundle.go\` 定义发布包布局和安装入口：

\`\`\`go
type mosDNSBundleLayout struct {
    MosDNSBinary string
    MosDNSRoot   string
    TrafficAgent string
    TrafficRoot  string
}

func (a *App) installMosDNSBundle(ctx context.Context, archive, iface string) error {
    // 解压到 DataDir/data/uploads 的暂存目录，验证结构与 ELF，
    // 写入接口名，最后用 os.Rename 原子替换受管目录。
    return nil
}
\`\`\`

必须复用现有 \`extractZipPreserve\` 与 \`cleanArchivePath\`，拒绝缺少 \`cus/bin/mosdns\`、\`cus/mosdns\`、\`monitor/bin/mosdns-traffic-agent\`、\`monitor/config/config.json\` 的包。

- [ ] **步骤 4：运行测试验证通过**

运行：\`go test ./internal/server -run 'TestInstallMosDNSBundle' -count=1\`

预期：PASS。

- [ ] **步骤 5：提交**

\`\`\`bash
git add internal/server/mosdns_bundle.go internal/server/mosdns_bundle_test.go
git commit -m "feat: install MosDNS bundles"
\`\`\`

### 任务 2：上传、任意 URL 与回滚

**文件：**
- 修改：\`internal/server/mosdns_bundle.go\`
- 修改：\`internal/server/component_upload.go\`
- 修改：\`internal/server/handlers_mosdns.go\`
- 测试：\`internal/server/mosdns_bundle_test.go\`

- [ ] **步骤 1：编写 URL 失败不替换当前包的测试**

\`\`\`go
func TestInstallMosDNSBundleFromURLKeepsCurrentRuntimeOnFailure(t *testing.T) {
    app := newTestApp(t)
    installExistingBundle(t, app, "old")
    server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
        _, _ = w.Write([]byte("not a zip"))
    }))
    defer server.Close()

    if err := app.installMosDNSBundleFromURL(context.Background(), server.URL, "eth0"); err == nil {
        t.Fatal("expected invalid archive error")
    }
    if got := readInstalledMosDNSMarker(t, app); got != "old" {
        t.Fatalf("installed bundle changed to %q", got)
    }
}
\`\`\`

- [ ] **步骤 2：运行测试验证失败**

运行：\`go test ./internal/server -run TestInstallMosDNSBundleFromURLKeepsCurrentRuntimeOnFailure -count=1\`

预期：FAIL，URL 安装方法不存在。

- [ ] **步骤 3：实现来源适配**

实现只接受 \`http\` / \`https\`、限制下载大小的 \`installMosDNSBundleFromURL\`。将 \`POST /api/v1/mosdns/install\` 设为：
- \`multipart/form-data\` 中的 \`file\`：安装上传 ZIP；
- JSON \`{"url":"https://..." }\`：下载并安装 URL ZIP；
- 两种来源同时存在或均不存在：返回 \`400\`。

MosDNS 的 \`handleComponentUpdateUpload\` 分支必须委托完整发布包安装器；Mihomo 与 Zashboard 上传逻辑保持原样。

- [ ] **步骤 4：运行测试验证通过**

运行：\`go test ./internal/server -run 'TestInstallMosDNSBundle|TestHandleMosDNSInstall' -count=1\`

预期：PASS。

- [ ] **步骤 5：提交**

\`\`\`bash
git add internal/server/mosdns_bundle.go internal/server/mosdns_bundle_test.go internal/server/component_upload.go internal/server/handlers_mosdns.go
git commit -m "feat: accept uploaded or remote MosDNS bundles"
\`\`\`

### 任务 3：成对服务生命周期与配置根目录

**文件：**
- 修改：\`internal/server/process.go\`
- 修改：\`internal/server/runtime.go\`
- 修改：\`internal/server/runtime_templates.go\`
- 修改：\`internal/server/paths.go\`
- 修改：\`internal/server/mosdns_compat.go\`
- 测试：\`internal/server/server_test.go\`
- 测试：\`internal/server/mosdns_runtime_sync_test.go\`

- [ ] **步骤 1：编写成对启动和发布包规则路径的失败测试**

\`\`\`go
func TestMosDNSStartAlsoStartsTrafficAgent(t *testing.T) {
    app := newTestApp(t)
    installRunnableMosDNSBundle(t, app)

    if _, err := app.Services.Start(context.Background(), "mosdns"); err != nil {
        t.Fatal(err)
    }
    if !app.Services.Status("mosdns-traffic-agent").Running {
        t.Fatal("traffic agent was not started with mosdns")
    }
}

func TestMosDNSRulesUseBundleRuleDirectory(t *testing.T) {
    app := newTestApp(t)
    installBundleConfig(t, app)

    res := requestJSON(t, app, http.MethodPost, "/api/v1/mosdns/rules/whitelist", adminToken(t, app), map[string]any{"pattern": "domain:example.com"})
    if res.Code != http.StatusOK {
        t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
    }
    mustContainFile(t, filepath.Join(app.DataDir, "configs/mosdns/rule/whitelist.txt"), "domain:example.com")
}
\`\`\`

- [ ] **步骤 2：运行测试验证失败**

运行：\`go test ./internal/server -run 'TestMosDNSStartAlsoStartsTrafficAgent|TestMosDNSRulesUseBundleRuleDirectory' -count=1\`

预期：FAIL，缺少流量代理服务规格，或规则仍写入旧目录。

- [ ] **步骤 3：实现成对服务和路径映射**

在 \`process.go\` 增加 \`mosdns-traffic-agent\` 服务规格，使用发布包中受管的 \`monitor/config/config.json\`。使 \`Start/Stop/Restart("mosdns")\` 分别按“MosDNS 后流量代理启动”和“流量代理后 MosDNS 停止”执行。将发布包配置根定位为：
- 主配置：\`configs/mosdns/config_custom.yaml\`
- 规则：\`configs/mosdns/rule/\`
- Web 信息：\`configs/mosdns/webinfo/\`
- 流量代理：\`configs/monitor/\`

旧模板不得覆盖已安装发布包；既有 \`/api/v1/mosdns/*\` 路由继续返回真实操作结果。

- [ ] **步骤 4：运行测试验证通过**

运行：\`go test ./internal/server -run 'TestMosDNSStartAlsoStartsTrafficAgent|TestMosDNSRulesUseBundleRuleDirectory|TestMosDNSRuntimeSync' -count=1\`

预期：PASS。

- [ ] **步骤 5：提交**

\`\`\`bash
git add internal/server/process.go internal/server/runtime.go internal/server/runtime_templates.go internal/server/paths.go internal/server/mosdns_compat.go internal/server/server_test.go internal/server/mosdns_runtime_sync_test.go
git commit -m "feat: manage MosDNS bundle runtime"
\`\`\`

### 任务 4：后端流量监控 API

**文件：**
- 创建：\`internal/server/mosdns_traffic.go\`
- 创建：\`internal/server/mosdns_traffic_test.go\`
- 修改：\`internal/server/handlers_mosdns.go\`

- [ ] **步骤 1：编写流量快照与代理失败的失败测试**

\`\`\`go
func TestMosDNSTrafficSnapshotProxiesLocalAgent(t *testing.T) {
    app, agent := newTrafficAgentTestApp(t, http.StatusOK, `{"ok":true,"devices":[{"ip":"192.168.1.2","rx_rate":8}]}`)
    defer agent.Close()

    res := requestJSON(t, app, http.MethodGet, "/api/v1/mosdns/traffic/snapshot", adminToken(t, app), nil)
    if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"ip":"192.168.1.2"`) {
        t.Fatal(res.Body.String())
    }
}

func TestMosDNSTrafficSnapshotReportsUnavailable(t *testing.T) {
    app := newTestApp(t)
    res := requestJSON(t, app, http.MethodGet, "/api/v1/mosdns/traffic/snapshot", adminToken(t, app), nil)
    if res.Code != http.StatusServiceUnavailable {
        t.Fatalf("status=%d", res.Code)
    }
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`go test ./internal/server -run TestMosDNSTraffic -count=1`

预期：FAIL，路由未注册。

- [ ] **步骤 3：实现四个同源接口**

注册以下路由并以短超时代理到 `127.0.0.1:9199`：

```text
GET /api/v1/mosdns/traffic/status
GET /api/v1/mosdns/traffic/snapshot
GET /api/v1/mosdns/traffic/clients
GET /api/v1/mosdns/traffic/client?ip={ip}
```

校验 `ip` 参数，统一返回 `{success,data}`；代理不可用时返回状态码 `503` 与错误码 `traffic_agent_unavailable`。

- [ ] **步骤 4：运行测试验证通过**

运行：`go test ./internal/server -run TestMosDNSTraffic -count=1`

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add internal/server/mosdns_traffic.go internal/server/mosdns_traffic_test.go internal/server/handlers_mosdns.go
git commit -m "feat: proxy MosDNS device traffic"
```

### 任务 5：初始化包来源与流量监控页面

**文件：**
- 修改：`web/src/pages/SetupPage.tsx`
- 修改：`web/src/pages/setup/setup-validation.ts`
- 修改：`internal/server/handlers_setup.go`
- 创建：`web/src/app/mosdns/traffic/page.tsx`
- 创建：`web/src/app/mosdns/traffic/traffic.test.tsx`
- 修改：`web/src/App.tsx`、`web/src/lib/dashboard-data.ts`、`web/src/components/MobileNav.tsx`
- 测试：`web/src/lib/setup-validation.test.ts`

- [ ] **步骤 1：为缺失 ZIP 来源和流量表渲染编写失败测试**

```ts
it("requires a MosDNS bundle source", () => {
  const issues = validateAllSetupSteps({ ...validSetupForm, mosdnsBundleURL: "", mosdnsBundleFile: null });
  expect(issues).toContainEqual(expect.objectContaining({ field: "mosdnsBundleURL" }));
});
```

```tsx
it("renders traffic devices returned by the MSF API", async () => {
  mockAPI({ data: { devices: [{ ip: "192.168.1.2", rx_rate: 8, tx_rate: 2, connections: 3 }] } });
  render(<MosdnsTrafficPage />);
  expect(await screen.findByText("192.168.1.2")).toBeInTheDocument();
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`cd web && npm test -- setup-validation.test.ts traffic.test.tsx`

预期：FAIL，表单字段和流量页面不存在。

- [ ] **步骤 3：实现初始化与页面**

初始化页提供上传 ZIP 或填写 URL 两种互斥输入；调用 `POST /api/v1/mosdns/install` 后才继续 Mihomo 下载和服务激活。移除 MosDNS 的 `EventSource('/api/v1/setup/download/mosdns')` 调用。

新增 `/mosdns/traffic`，在 MosDNS 导航和移动导航中加入“流量监控”。页面沿用 `AppShell`、`WorkbenchHeader` 和现有表格样式；每秒请求 snapshot，展示状态、总上传/下载、活跃设备和稳定排序的设备列表，点击 IP 打开详情。任何浏览器代码都不得访问 `:9199`。

- [ ] **步骤 4：运行测试、类型检查和构建**

运行：`cd web && npm test -- setup-validation.test.ts traffic.test.tsx && npm run check`

预期：PASS，类型检查和 Vite 构建成功。

- [ ] **步骤 5：提交**

```bash
git add web/src/pages/SetupPage.tsx web/src/pages/setup/setup-validation.ts web/src/lib/setup-validation.test.ts web/src/app/mosdns/traffic/page.tsx web/src/app/mosdns/traffic/traffic.test.tsx web/src/App.tsx web/src/lib/dashboard-data.ts web/src/components/MobileNav.tsx internal/server/handlers_setup.go
git commit -m "feat: add bundle setup and traffic monitor"
```

### 任务 6：删除非 Linux amd64 支持并做全量验证

**文件：**
- 修改：`Makefile`、`README.md`、`README.en.md`、`RELEASING.md`、Linux 打包文档。
- 删除：`Dockerfile`、`docker-compose.yml`、`docker-compose.macvlan.yml`、`docker-run.sh`、`docker.env.example`、`macos/`、`packaging/unraid/`、`packaging/fnos/`、相关 Docker/macOS/Unraid/fnOS CI 与脚本。
- 测试：Linux 相关命令与发布校验。

- [ ] **步骤 1：确认现有非目标发布引用存在**

运行：`rg -n -i 'docker|macos|unraid|fnos|arm64' Makefile README.md README.en.md RELEASING.md .github packaging scripts`

预期：命令返回非 Linux amd64 的发布或文档引用。

- [ ] **步骤 2：删除非目标运行时、打包与文档**

保留 `make package GOOS=linux GOARCH=amd64` 及 systemd/tarball 安装文档。删除的平台测试也同步删除；Linux 相关测试和发布校验改为只断言 `dist/msf-linux-amd64.tar.gz`。

- [ ] **步骤 3：验证 Linux-only 发布链**

运行：`rg -n -i 'docker|macos|unraid|fnos' Makefile README.md README.en.md RELEASING.md .github packaging scripts || true; make package GOOS=linux GOARCH=amd64`

预期：第一条不再返回产品支持或发布引用；第二条生成 `dist/msf-linux-amd64.tar.gz`。

- [ ] **步骤 4：运行全部验证**

运行：`go test ./... && cd web && npm test && npm run check && cd .. && git diff --check`

预期：全部通过，且没有空白错误。

- [ ] **步骤 5：提交**

```bash
git add -A
git commit -m "refactor: restrict MSF to Linux amd64"
```
