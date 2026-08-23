#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
let baseURL = process.env.MSF_E2E_BASE_URL || "";
let vite;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startVite() {
  if (process.env.MSF_E2E_BASE_URL) return;
  const port = await freePort();
  baseURL = `http://127.0.0.1:${port}`;
  vite = spawn(process.execPath, [path.join(repoRoot, "web/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: path.join(repoRoot, "web"),
    stdio: ["ignore", "pipe", "pipe"],
  });
  vite.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
  vite.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function main() {
  await startVite();
  await waitForServer(baseURL);

  let setupConfig = {
    selected_interface: "eth0",
    proxy_core: "mihomo",
    mihomo_core_type: "meta",
    linux_proxy_mode: "nft",
    auto_set_dns: true,
    dns_on: "127.0.0.1",
    dns_off: "223.5.5.5",
    enable_ipv6: false,
    fake_ip_range_v4: "28.0.0.0/8",
    fake_ip_range_v6: "f2b0::/18",
    subscription_urls: "test|https://example.invalid/sub.yaml",
    mihomo_proxies: "",
  };
  let priority = "auto";
  let priorityRequests = 0;
  let failNextPriority = false;
  const setupWrites = [];

  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem("msf_token", "e2e-token"));
  const page = await context.newPage();

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();

    if (pathname === "/api/v1/setup/check") return json(route, { is_initialized: true });
    if (pathname === "/api/v1/auth/me") return json(route, { user: { username: "e2e", role: "admin" } });
    if (pathname === "/api/v1/settings" && method === "GET") return json(route, { data: { token_retention_hours: "24" } });
    if (pathname === "/api/v1/setup/config" && method === "GET") return json(route, { data: setupConfig });
    if (pathname === "/api/v1/setup/config" && method === "PUT") {
      const body = JSON.parse(request.postData() || "{}");
      setupWrites.push(body);
      setupConfig = {
        ...setupConfig,
        ...body,
        fake_ip_range_v6: body.fake_ip_range_v6 === "f2b0:1234::1/48" ? "f2b0:1234::/48" : body.fake_ip_range_v6,
      };
      return json(route, { success: true, data: setupConfig });
    }
    if (pathname === "/api/v1/setup/network-interfaces") return json(route, { data: [{ name: "eth0", addresses: ["192.0.2.2"] }] });
    if (pathname === "/api/v1/setup/privilege") return json(route, { runtime: { docker: false, macos: false } });

    if (pathname === "/api/v1/mosdns/system/feature-switches" || pathname === "/api/v1/mosdns/system/switches") {
      const rows = [
        { key: "switch3", value: true },
        { key: "switch6", value: false },
        { key: "switch8", value: priority === "ipv4" },
        { key: "switch10", value: priority === "ipv6" },
      ];
      return json(route, { data: rows });
    }
    if (pathname === "/api/v1/mosdns/system/priority" && method === "PUT") {
      priorityRequests += 1;
      const body = JSON.parse(request.postData() || "{}");
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (failNextPriority) {
        failNextPriority = false;
        return json(route, { error: "priority_save_failed", message: "模拟保存失败" }, 500);
      }
      priority = body.priority;
      return json(route, { success: true, data: { priority } });
    }
    if (pathname === "/api/v1/mosdns/system/upstream-overrides") return json(route, { data: {} });
    if (pathname === "/api/v1/mosdns/system/overrides") return json(route, { data: { ecs: "2408:8214:213::1" } });
    if (pathname === "/api/v1/mosdns/system/log-capacity") return json(route, { data: { capacity: 100000 } });
    if (pathname === "/api/v1/mosdns/system/cache") return json(route, { data: { entries: 0 } });
    if (pathname === "/api/v1/mosdns/system/routing") return json(route, { data: {} });
    if (pathname === "/api/v1/mosdns/cache/detailed") return json(route, { data: { domains: {} } });

    return json(route, { success: true, data: {} });
  });

  try {
    await page.goto(`${baseURL}/settings?tab=system`);
    await page.getByText("启用 IPv6 数据面", { exact: true }).first().waitFor();
    const disabledSummary = page.locator("div").filter({ hasText: /^启用 IPv6 数据面已禁用$/ });
    await disabledSummary.waitFor();

    await page.getByRole("button", { name: "编辑配置" }).click();
    await page.getByText("修改后若个别网页仍无法访问", { exact: false }).waitFor();
    const ipv6Toggle = page.locator("label").filter({ hasText: "启用 IPv6 数据面" }).locator('input[type="checkbox"]');
    await ipv6Toggle.check();
    await page.getByLabel("IPv6 FakeIP 网段").fill("f2b0:1234::1/48");
    await page.getByRole("button", { name: "保存配置" }).click();
    await page.getByRole("button", { name: "编辑配置" }).waitFor();

    assert.equal(setupWrites.length, 1, "IPv6 settings should be saved with one setup request");
    assert.equal(setupWrites[0].enable_ipv6, true);
    assert.equal(setupWrites[0].fake_ip_range_v6, "f2b0:1234::1/48");

    await page.reload();
    await page.locator("div").filter({ hasText: /^启用 IPv6 数据面已启用$/ }).waitFor();
    await page.getByRole("button", { name: "编辑配置" }).click();
    await page.getByLabel("IPv6 FakeIP 网段").waitFor();
    assert.equal(await page.getByLabel("IPv6 FakeIP 网段").inputValue(), "f2b0:1234::/48");

    await page.goto(`${baseURL}/mosdns/system`);
    const auto = page.getByRole("radio", { name: "自动", exact: true });
    const ipv4 = page.getByRole("radio", { name: "IPv4 优先", exact: true });
    const ipv6 = page.getByRole("radio", { name: "IPv6 优先", exact: true });
    await auto.waitFor();
    assert.equal(await auto.getAttribute("aria-checked"), "true");

    await ipv6.click();
    await page.waitForTimeout(20);
    assert.equal(await ipv6.isDisabled(), true, "priority controls should be disabled while saving");
    await page.waitForTimeout(200);
    assert.equal(priorityRequests, 1, "one priority selection must produce one atomic request");
    assert.equal(await ipv6.getAttribute("aria-checked"), "true");

    await page.reload();
    await page.getByRole("radio", { name: "IPv6 优先", exact: true, checked: true }).waitFor();
    assert.equal(await ipv6.getAttribute("aria-checked"), "true", "saved priority should survive refresh");

    failNextPriority = true;
    await ipv4.click();
    await page.getByText("模拟保存失败", { exact: false }).waitFor();
    assert.equal(await ipv6.getAttribute("aria-checked"), "true", "failed optimistic update should roll back");
    assert.equal(priorityRequests, 2);

    console.log("Playwright IPv6 settings and MosDNS priority flow passed");
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (vite && !vite.killed) {
    vite.kill("SIGTERM");
    await new Promise((resolve) => vite.once("exit", resolve));
  }
}
