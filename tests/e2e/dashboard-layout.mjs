#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const screenshotDir = path.join(repoRoot, "docs/acceptance/dashboard");
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
  vite = spawn(
    process.execPath,
    [path.join(repoRoot, "web/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: path.join(repoRoot, "web"), stdio: ["ignore", "pipe", "pipe"] },
  );
  vite.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
  vite.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockApi(page) {
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/setup/check") return json(route, { is_initialized: true });
    if (pathname === "/api/v1/auth/me") return json(route, { user: { username: "e2e", role: "admin" } });
    if (pathname === "/api/v1/version") return json(route, { version: "dashboard-e2e" });
    if (pathname === "/api/v1/events/monitor") {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `event: monitor\ndata: ${JSON.stringify({ timestamp: Date.now(), cpu_percent: 23, memory_percent: 41, download_speed: 245760, upload_speed: 98304, connections: 36 })}\n\n`,
      });
    }
    if (pathname === "/api/v1/monitor/system") return json(route, { data: { hostname: "msf-e2e", platform: "Linux / amd64", uptime_seconds: 86461, data_dir: "/opt/msf" } });
    if (pathname === "/api/v1/monitor/resources") return json(route, { data: { cpu_percent: 23, memory_percent: 41, cpu_model: "Virtual CPU", cpu_cores: 4, memory_total: 8 * 1024 ** 3, disk_total: 64 * 1024 ** 3, disk_percent: 37 } });
    if (pathname === "/api/v1/monitor/network") return json(route, { data: { download_speed: 245760, upload_speed: 98304, connections: 36, total_download: 16 * 1024 ** 3, total_upload: 4 * 1024 ** 3 } });
    if (pathname === "/api/v1/monitor/history") return json(route, { data: [0, 1, 2, 3].map((offset) => ({ timestamp: Date.now() - (3 - offset) * 1000, cpu_percent: 20 + offset, memory_percent: 40 + offset, download_speed: 200000 + offset * 10000, upload_speed: 80000 + offset * 5000, connections: 30 + offset })) });
    if (pathname === "/api/v1/mihomo/proxies") return json(route, { data: {
      groups: [{ name: "节点选择", type: "Selector", all: ["香港节点", "新加坡节点", "韩国节点", "台湾节点", "日本节点", "美国节点", "德国节点", "英国节点"], now: "美国节点", order: 0 }],
      proxies: {
        "节点选择": { name: "节点选择", type: "Selector", all: ["香港节点", "新加坡节点", "韩国节点", "台湾节点", "日本节点", "美国节点", "德国节点", "英国节点"], now: "美国节点" },
        "香港节点": { name: "香港节点", type: "URLTest", delay: 190, alive: true },
        "新加坡节点": { name: "新加坡节点", type: "URLTest", delay: 147, alive: true },
        "韩国节点": { name: "韩国节点", type: "URLTest", delay: 0, alive: true },
        "台湾节点": { name: "台湾节点", type: "URLTest", delay: 220, alive: true },
        "日本节点": { name: "日本节点", type: "URLTest", delay: 204, alive: true },
        "美国节点": { name: "美国节点", type: "URLTest", delay: 169, alive: true },
        "德国节点": { name: "德国节点", type: "URLTest", delay: 182, alive: true },
        "英国节点": { name: "英国节点", type: "URLTest", delay: 176, alive: true },
      },
    } });
    if (pathname === "/api/v1/mihomo/overview") return json(route, { data: {} });
    if (pathname === "/api/v1/mihomo/proxy-providers") return json(route, { data: { providers: {} } });
    if (pathname === "/api/v1/mihomo/config/mode") return json(route, { data: { mode: "custom", can_edit_groups: true } });
    if (pathname === "/api/v1/mihomo/connections") return json(route, { data: { connections: [] } });
    if (pathname.startsWith("/api/v1/mihomo/proxies/") && route.request().method() === "PUT") return json(route, { success: true });
    if (pathname === "/api/v1/services") return json(route, { data: [
      { name: "mosdns", display_name: "MosDNS", running: true, installed: true, cpu_percent: 1.2, memory_bytes: 32 * 1024 ** 2, uptime_seconds: 3600 },
      { name: "singbox", display_name: "Sing-Box", running: false, installed: false },
      { name: "mihomo", display_name: "Mihomo", running: true, installed: true, cpu_percent: 2.4, memory_bytes: 96 * 1024 ** 2, uptime_seconds: 7200 },
    ] });
    return json(route, { success: true, data: {} });
  });
}

async function waitForStablePage(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 7_500 }).catch(() => {});
  await page.locator(".dashboard-grid").waitFor();
}

async function openPicker(page) {
  const button = page.getByRole("button", { name: /打开仪表盘组件|完成仪表盘编辑/ });
  await button.click();
  const dialog = page.getByRole("dialog", { name: "仪表盘组件" });
  await dialog.waitFor();
  return dialog;
}

async function selectedCount(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "{}").instances?.length ?? 0);
}

async function main() {
  await fs.mkdir(screenshotDir, { recursive: true });
  await startVite();
  await waitForServer(baseURL);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const legacy = {
    compact: false,
    visible: { device: false, hardware: true, stats: false, resources: true, rate: true, mosdns: true, singbox: true, mihomo: true },
  };
  await context.addInitScript((settings) => {
    localStorage.setItem("msf_token", "dashboard-e2e-token");
    if (!localStorage.getItem("msf.dashboard.settings.v3")) localStorage.setItem("msf.dashboard.settings.v1", JSON.stringify(settings));
  }, legacy);
  await context.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.__dashboardMonitorStreams = { active: 0, maxActive: 0, calls: 0 };
    window.fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes("/api/v1/events/monitor")) return nativeFetch(input, init);
      const stats = window.__dashboardMonitorStreams;
      stats.calls += 1;
      stats.active += 1;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          let closed = false;
          controller.enqueue(encoder.encode(`event: monitor\ndata: ${JSON.stringify({ timestamp: Date.now(), cpu_percent: 23, memory_percent: 41, download_speed: 245760, upload_speed: 98304, connections: 36 })}\n\n`));
          const close = () => {
            if (closed) return;
            closed = true;
            stats.active -= 1;
            controller.close();
          };
          init?.signal?.addEventListener("abort", close, { once: true });
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    };
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await mockApi(page);

  try {
    await page.goto(`${baseURL}/`);
    await waitForStablePage(page);

    const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "null"));
    assert.equal(migrated.version, 3, "legacy settings should migrate to V3");
    assert.equal(migrated.instances.some((item) => item.type === "system-device"), false, "hidden legacy device card should stay hidden");
    assert.equal(migrated.instances.some((item) => item.type === "system-hardware"), true, "legacy hardware card should remain independent");
    assert.equal(migrated.instances.some((item) => item.type === "system-stats"), false, "hidden legacy stats card should stay hidden");
    assert.equal(migrated.instances.some((item) => item.type === "singbox-service"), false, "Sing-Box must not migrate into V3");

    let dialog = await openPicker(page);
    for (const label of ["系统", "MosDNS", "Mihomo"]) await dialog.getByRole("heading", { name: label, exact: true }).waitFor();
    const initialPickerGeometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const parentRect = element.parentElement?.getBoundingClientRect();
      return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }, position: style.position, left: style.left, right: style.right, top: style.top, bottom: style.bottom, parent: parentRect ? { x: parentRect.x, y: parentRect.y, width: parentRect.width, height: parentRect.height } : null };
    });
    assert.ok(initialPickerGeometry.rect.y >= 0 && initialPickerGeometry.rect.bottom <= 1000 && initialPickerGeometry.rect.x >= 0 && initialPickerGeometry.rect.right <= 1440, `desktop picker must stay in the viewport: ${JSON.stringify(initialPickerGeometry)}`);
    await page.locator('.dashboard-grid[data-editing="true"]').waitFor();
    await page.locator("[data-dashboard-card-header]").first().click();
    await dialog.waitFor();
    assert.equal(await dialog.getAttribute("aria-modal"), null, "desktop picker should stay non-modal while cards are edited behind it");
    assert.equal(await dialog.locator('input[type="search"], input[placeholder*="搜索"]').count(), 0, "picker must not contain search");
    assert.equal(await selectedCount(page), 5);

    const systemCollectionButton = dialog.getByRole("button", { name: /系统信息集合/ }).first();
    assert.equal(await systemCollectionButton.getAttribute("aria-pressed"), "false");
    await systemCollectionButton.click();
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "关闭组件面板" }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.getByRole("button", { name: "打开仪表盘组件" }).evaluate((element) => document.activeElement === element), true, "closing the picker should restore focus to the FAB");
    const systemCollection = page.locator('[data-widget-type="system-info"]');
    await systemCollection.waitFor();
    assert.equal(await systemCollection.getByRole("tablist").count(), 0, "collection navigation should no longer consume content height");
    const systemHeader = systemCollection.locator("[data-dashboard-card-header]");
    await systemHeader.getByRole("combobox", { name: "系统信息页面" }).waitFor();
    await systemCollection.getByRole("button", { name: "选择集合内容" }).click();
    const collectionDialog = page.getByRole("dialog", { name: "系统信息页面内容设置" });
    assert.equal(await collectionDialog.evaluate((element) => element.contains(document.activeElement)), true, "collection settings should receive focus when opened");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await collectionDialog.evaluate((element) => element.contains(document.activeElement)), true, "initial reverse tab should stay inside collection settings");
    await collectionDialog.getByRole("button", { name: "统计信息", exact: true }).click();
    await collectionDialog.getByRole("button", { name: "关闭集合设置" }).click();
    assert.equal(await systemCollection.getByRole("button", { name: "选择集合内容" }).evaluate((element) => document.activeElement === element), true, "closing collection settings should restore its trigger focus");
    const collectionState = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "{}");
      return {
        pages: stored.instances?.find((item) => item.type === "system-info")?.settings?.pages,
        hasIndependentHardware: stored.instances?.some((item) => item.type === "system-hardware"),
      };
    });
    assert.deepEqual(collectionState.pages, ["device", "hardware"], "a collection should save multiple selected pages and keep paginated tabs");
    assert.equal(collectionState.hasIndependentHardware, true, "an independent info card must coexist with the merged collection");
    dialog = await openPicker(page);
    await systemCollection.getByRole("button", { name: "选择集合内容" }).evaluate((element) => element.click());
    const escapeCollectionDialog = page.getByRole("dialog", { name: "系统信息页面内容设置" });
    await escapeCollectionDialog.waitFor();
    await page.keyboard.press("Escape");
    await escapeCollectionDialog.waitFor({ state: "detached" });
    await dialog.waitFor();
    await page.locator('.dashboard-grid[data-editing="true"]').waitFor();

    while ((await selectedCount(page)) < 15) {
      const candidate = dialog.locator('button[aria-pressed="false"]:not([disabled])').first();
      assert.equal(await candidate.count(), 1, "there should be an addable widget before the limit");
      await candidate.click();
    }
    await dialog.getByText("最多启用 15 个组件", { exact: false }).waitFor();
    assert.ok(await dialog.locator('button[aria-pressed="false"][disabled]').count() > 0, "unselected widgets must disable at 15");
    const selectedButton = dialog.locator('button[aria-pressed="true"]').first();
    await selectedButton.click();
    assert.equal(await selectedCount(page), 14);
    const restoredCandidate = dialog.locator('button[aria-pressed="false"]:not([disabled])').first();
    assert.ok(await restoredCandidate.count() > 0, "removing one widget must restore additions");
    await restoredCandidate.click();
    assert.equal(await selectedCount(page), 15, "the restored slot should accept a fifteenth widget");

    const desktopResizeHandle = page.locator(".react-resizable-handle").first();
    await desktopResizeHandle.waitFor();
    assert.notEqual(await desktopResizeHandle.evaluate((element) => getComputedStyle(element).display), "none", "opening the picker should immediately show desktop resize handles");
    const resizeTarget = page.locator(".react-grid-item").first();
    const resizeTargetId = await resizeTarget.getAttribute("data-widget-id");
    assert.ok(resizeTargetId, "the resize target should have a widget id");
    const beforeResize = await page.evaluate((id) => {
      const settings = JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "{}");
      return settings.layouts.desktop.find((item) => item.i === id);
    }, resizeTargetId);
    const resizeBox = await desktopResizeHandle.boundingBox();
    assert.ok(resizeBox, "desktop resize handle should have a bounding box");
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 170, resizeBox.y + resizeBox.height / 2 + 70, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const afterResize = await page.evaluate((id) => {
      const settings = JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "{}");
      return settings.layouts.desktop.find((item) => item.i === id);
    }, resizeTargetId);
    assert.notDeepEqual(afterResize, beforeResize, "resizing a card should persist a changed layout item");
    await systemHeader.getByRole("combobox", { name: "系统信息页面" }).selectOption("hardware");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "{}").instances.find((item) => item.type === "system-info")?.settings?.activePage === "hardware");
    await dialog.getByRole("button", { name: "撤销调整" }).click();
    await page.waitForFunction(({ id, expected }) => {
      const settings = JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "{}");
      return JSON.stringify(settings.layouts.desktop.find((item) => item.i === id)) === JSON.stringify(expected);
    }, { id: resizeTargetId, expected: beforeResize });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "{}").instances.find((item) => item.type === "system-info")?.settings?.activePage), "hardware", "undoing a layout adjustment must preserve later widget settings changes");
    await dialog.waitFor();

    const beforeDefaultLayout = await page.evaluate(() => localStorage.getItem("msf.dashboard.settings.v3"));
    await dialog.getByRole("button", { name: "默认布局" }).click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "{}").instances?.length === 7);
    const defaultTypes = await page.evaluate(() => JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "{}").instances.map((item) => item.type));
    assert.deepEqual(defaultTypes, ["system-device", "system-hardware", "system-resources", "system-rate", "system-stats", "mosdns-service", "mihomo-service"], "default layout should restore the original seven-card homepage");
    const defaultPair = await page.evaluate(() => {
      const desktop = JSON.parse(localStorage.getItem("msf.dashboard.settings.v3") || "{}").layouts.desktop;
      return {
        rate: desktop.find((item) => item.i === "system-rate"),
        stats: desktop.find((item) => item.i === "system-stats"),
      };
    });
    assert.deepEqual({ x: defaultPair.rate.x, w: defaultPair.rate.w }, { x: 0, w: 6 }, "default rate card should use the left half of the row");
    assert.deepEqual({ x: defaultPair.stats.x, w: defaultPair.stats.w }, { x: 6, w: 6 }, "default stats card should use the right half of the row");
    await page.setViewportSize({ width: 2048, height: 1179 });
    await page.locator('.dashboard-grid[data-breakpoint="desktop"]').waitFor();
    await page.waitForTimeout(350);
    const defaultRateWidget = page.locator('[data-widget-type="system-rate"]');
    await defaultRateWidget.locator('[data-rate-layout="compact"]').waitFor();
    assert.equal(await defaultRateWidget.locator('[data-rate-metrics-placement="header"]').count(), 0, "half-width rate card should remove the top metrics row");
    await defaultRateWidget.locator('[data-rate-metrics-placement="footer"]').waitFor();
    const rateFooterGeometry = await defaultRateWidget.evaluate((widget) => {
      const metrics = widget.querySelector('[data-rate-metrics-placement="footer"]');
      const selector = widget.querySelector(".gary-segmented");
      if (!metrics || !selector) return null;
      const metricsRect = metrics.getBoundingClientRect();
      const selectorRect = selector.getBoundingClientRect();
      const metricTops = Array.from(metrics.children).map((child) => Math.round(child.getBoundingClientRect().top));
      const separated = metricsRect.right <= selectorRect.left + 1 || metricsRect.bottom <= selectorRect.top + 1;
      return { separated, metricsSingleRow: Math.max(...metricTops) - Math.min(...metricTops) <= 2, selectorClientWidth: selector.clientWidth, selectorScrollWidth: selector.scrollWidth };
    });
    assert.ok(rateFooterGeometry?.separated, `rate legend metrics and time selector must not overlap: ${JSON.stringify(rateFooterGeometry)}`);
    assert.ok(rateFooterGeometry.metricsSingleRow, `rate values and legends should share one row at 2048px: ${JSON.stringify(rateFooterGeometry)}`);
    assert.ok(rateFooterGeometry.selectorScrollWidth <= rateFooterGeometry.selectorClientWidth + 1, `time selector must remain fully visible: ${JSON.stringify(rateFooterGeometry)}`);
    await defaultRateWidget.screenshot({ path: path.join(screenshotDir, "dashboard-default-rate-card-2048.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.dashboard-grid[data-breakpoint="desktop"]').waitFor();
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "撤销调整" }).click();
    await page.waitForFunction((expected) => localStorage.getItem("msf.dashboard.settings.v3") === expected, beforeDefaultLayout);
    assert.equal(await selectedCount(page), 15, "undo should restore the dashboard that existed before default layout");
    await page.getByRole("button", { name: "完成仪表盘编辑" }).click();
    await page.locator('.dashboard-grid[data-editing="true"]').waitFor({ state: "detached" });
    await dialog.waitFor({ state: "detached" });

    const beforeReload = await page.evaluate(() => localStorage.getItem("msf.dashboard.settings.v3"));
    await page.reload();
    await waitForStablePage(page);
    assert.equal(await page.evaluate(() => localStorage.getItem("msf.dashboard.settings.v3")), beforeReload, "layout and visibility must survive refresh");

    const viewports = [
      { width: 1440, height: 1000, name: "dashboard-1440.png" },
      { width: 1024, height: 900, name: "dashboard-1024.png" },
      { width: 768, height: 900, name: "dashboard-768.png" },
      { width: 390, height: 844, name: "dashboard-390.png" },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(350);
      const overflow = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        structure: ["#main-content", "#main-content > div", "#main-content > div > div", ".dashboard-grid", ".react-grid-layout"].map((selector) => {
          const element = document.querySelector(selector);
          if (!element) return { selector, missing: true };
          const rect = element.getBoundingClientRect();
          return { selector, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
        }),
        offenders: Array.from(document.querySelectorAll("body *"))
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            className: typeof element.className === "string" ? element.className.slice(0, 160) : "",
            left: Math.round(element.getBoundingClientRect().left),
            right: Math.round(element.getBoundingClientRect().right),
            width: Math.round(element.getBoundingClientRect().width),
          }))
          .filter((item) => item.right > window.innerWidth + 2 || item.left < -2)
          .sort((left, right) => right.right - left.right)
          .slice(0, 8),
      }));
      assert.ok(overflow.scrollWidth <= overflow.innerWidth + 2, `viewport overflow at ${viewport.width}px: ${JSON.stringify(overflow)}`);
      await page.screenshot({ path: path.join(screenshotDir, viewport.name), fullPage: true });
    }
    assert.equal(await page.getByText(/组件正在接入/).count(), 0, "all registered dashboard widgets must have a real renderer");

    await page.setViewportSize({ width: 390, height: 844 });
    dialog = await openPicker(page);
    await page.locator('.dashboard-grid[data-breakpoint="mobile"][data-editing="true"]').waitFor();
    const mobileHandles = page.locator(".react-resizable-handle");
    for (let index = 0; index < await mobileHandles.count(); index += 1) {
      assert.equal(await mobileHandles.nth(index).evaluate((element) => getComputedStyle(element).display), "none", "mobile must hide resize handles");
    }
    await dialog.getByRole("button", { name: "关闭组件面板" }).click();
    await dialog.waitFor({ state: "detached" });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.dashboard-grid[data-breakpoint="desktop"]').waitFor();
    dialog = await openPicker(page);
    const requiredMihomoLabels = ["全球连接", "连接拓扑", "订阅流量统计", "连接统计", "规则命中统计", "自定义策略组控制"];
    let removedNonTarget = true;
    while (removedNonTarget) {
      removedNonTarget = false;
      const selectedWidgets = dialog.locator('button[aria-pressed="true"]');
      for (let index = 0; index < await selectedWidgets.count(); index += 1) {
        const button = selectedWidgets.nth(index);
        const label = (await button.innerText()).trim();
        if (requiredMihomoLabels.some((required) => label.includes(required))) continue;
        await button.click();
        removedNonTarget = true;
        break;
      }
    }
    for (const label of requiredMihomoLabels) {
      const widgetButton = dialog.getByRole("button", { name: new RegExp(label) }).first();
      assert.equal(await widgetButton.isDisabled(), false, `${label} should be addable`);
      if (await widgetButton.getAttribute("aria-pressed") !== "true") await widgetButton.click();
    }
    assert.equal(await selectedCount(page), requiredMihomoLabels.length, "the Mihomo-complete layout should contain each requested widget exactly once");
    await dialog.getByRole("button", { name: "关闭组件面板" }).dispatchEvent("click");
    for (const type of ["mihomo-globe", "mihomo-topology", "mihomo-provider-traffic", "mihomo-connection-stats", "mihomo-rule-hits", "mihomo-proxy-group"]) {
      await page.locator(`[data-widget-type="${type}"]`).waitFor();
    }
    const proxyGroupWidget = page.locator('[data-widget-type="mihomo-proxy-group"]');
    const proxyGroupHeader = proxyGroupWidget.locator("[data-dashboard-card-header]");
    const proxyGroupSelector = proxyGroupHeader.getByRole("combobox", { name: "选择策略组" });
    await proxyGroupSelector.waitFor();
    assert.equal(await proxyGroupWidget.locator(':scope > div > div:last-child select[aria-label="选择策略组"], :scope > div > div:last-child select[aria-label="更换策略组"]').count(), 0, "the strategy-group selector must not consume card content height");
    const proxyGroupValue = await proxyGroupSelector.locator("option").filter({ hasText: "节点选择" }).getAttribute("value");
    assert.ok(proxyGroupValue, "the mocked strategy group should be available in the title bar selector");
    await proxyGroupSelector.selectOption(proxyGroupValue);
    const embeddedProxyGroup = proxyGroupWidget.locator('[data-proxy-group-card="embedded"]');
    await embeddedProxyGroup.waitFor();
    await embeddedProxyGroup.getByRole("button", { name: "展开 节点选择" }).click();
    const nodePlate = embeddedProxyGroup.locator(".gary-solid-plate").first();
    await nodePlate.waitFor();
    const proxyGeometry = await proxyGroupWidget.evaluate((widget) => {
      const header = widget.querySelector("[data-dashboard-card-header]");
      const selector = header?.querySelector('select[aria-label="选择策略组"]');
      const embedded = widget.querySelector('[data-proxy-group-card="embedded"]');
      const root = embedded?.parentElement;
      const plate = embedded?.querySelector(".gary-solid-plate");
      if (!header || !selector || !embedded || !root || !plate) return null;
      const embeddedRect = embedded.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const plateRect = plate.getBoundingClientRect();
      return {
        selectorInHeader: header.contains(selector),
        rootWidth: rootRect.width,
        embeddedWidth: embeddedRect.width,
        plateWidth: plateRect.width,
      };
    });
    assert.ok(proxyGeometry?.selectorInHeader, "the strategy-group selector should live in the dashboard title bar");
    assert.ok(Math.abs(proxyGeometry.embeddedWidth - proxyGeometry.rootWidth) <= 2, `the strategy card should fill its content width: ${JSON.stringify(proxyGeometry)}`);
    assert.ok(proxyGeometry.plateWidth >= proxyGeometry.embeddedWidth - 32, `the expanded node area should adapt to the strategy card width: ${JSON.stringify(proxyGeometry)}`);
    assert.equal(await page.getByText(/组件正在接入/).count(), 0);
    await page.screenshot({ path: path.join(screenshotDir, "dashboard-mihomo-complete-1440.png"), fullPage: true });

    const monitorStreams = await page.evaluate(() => window.__dashboardMonitorStreams);
    assert.ok(monitorStreams.calls > 0, "dashboard should create the shared monitor SSE");
    assert.equal(monitorStreams.maxActive, 1, "dashboard must not create concurrent duplicate monitor SSE streams");

    await page.goto(`${baseURL}/mosdns/logs`);
    await page.waitForLoadState("domcontentloaded");
    assert.equal(await page.getByRole("button", { name: "打开仪表盘组件" }).count(), 0, "non-dashboard routes must not show the picker FAB");

    assert.deepEqual(browserErrors, [], `browser console errors: ${browserErrors.join(" | ")}`);
    console.log(`Dashboard E2E passed; screenshots: ${screenshotDir}`);
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
