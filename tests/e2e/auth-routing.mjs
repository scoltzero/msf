#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
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
  vite = spawn(
    process.execPath,
    [path.join(repoRoot, "web/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: path.join(repoRoot, "web"), stdio: ["ignore", "pipe", "pipe"] }
  );
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

async function mockApi(page, { initialized = true, session = "none", setupError = false } = {}) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === "/api/v1/setup/check") {
      return setupError ? json(route, { error: "setup_check_failed", message: "模拟初始化检查失败" }, 503) : json(route, { is_initialized: initialized });
    }
    if (pathname === "/api/v1/version") return json(route, { version: "test" });
    if (pathname === "/api/v1/auth/me") {
      return session === "expired" ? json(route, { error: "unauthorized" }, 401) : json(route, { user: { username: "root", role: "admin" } });
    }
    if (pathname === "/api/v1/auth/login") {
      return json(route, { token: "fresh-token", user: { username: "root", role: "admin" } });
    }
    return json(route, { success: true, data: {} });
  });
}

async function newContext(browser, token) {
  const context = await browser.newContext();
  if (token) {
    await context.addInitScript((value) => localStorage.setItem("msf_token", value), token);
  }
  return context;
}

async function assertPath(page, pathname) {
  await page.waitForFunction((expected) => window.location.pathname === expected, pathname);
  assert.equal(new URL(page.url()).pathname, pathname);
}

async function main() {
  await startVite();
  await waitForServer(baseURL);

  const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  try {
    {
      const context = await newContext(browser);
      const page = await context.newPage();
      await mockApi(page, { initialized: true, session: "none" });
      await page.goto(`${baseURL}/mosdns/logs`);
      await assertPath(page, "/login");
      await context.close();
    }

    {
      const context = await newContext(browser, "expired-token");
      const page = await context.newPage();
      await mockApi(page, { initialized: true, session: "expired" });
      await page.goto(`${baseURL}/mosdns/logs`);
      await assertPath(page, "/login");
      assert.equal(await page.evaluate(() => localStorage.getItem("msf_token")), null, "expired token should be removed");
      await context.close();
    }

    {
      const context = await newContext(browser);
      const page = await context.newPage();
      await mockApi(page, { initialized: false });
      await page.goto(`${baseURL}/mosdns/logs`);
      await assertPath(page, "/setup");
      await context.close();
    }

    {
      const context = await newContext(browser);
      const page = await context.newPage();
      await mockApi(page, { initialized: true, setupError: true });
      await page.goto(`${baseURL}/mosdns/logs`);
      await page.getByText("无法确认系统状态", { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, "/mosdns/logs", "setup check errors should not redirect to setup");
      await context.close();
    }

    {
      const context = await newContext(browser);
      const page = await context.newPage();
      await mockApi(page, { initialized: true, session: "none" });
      await page.goto(`${baseURL}/mosdns/logs?tab=all#top`);
      await assertPath(page, "/login");
      await page.locator('input[type="password"]').fill("password");
      await page.getByRole("button", { name: "登录" }).click();
      await page.waitForFunction(() => window.location.pathname === "/mosdns/logs");
      assert.equal(new URL(page.url()).search, "?tab=all");
      assert.equal(new URL(page.url()).hash, "#top");
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log("Auth routing regression tests passed");
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
