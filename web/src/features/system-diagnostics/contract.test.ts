import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const nav = readFileSync(new URL("../../lib/dashboard-data.ts", import.meta.url), "utf8");
const header = readFileSync(new URL("../../components/AppHeader.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../../components/system/DiagnosticsDialog.tsx", import.meta.url), "utf8");

describe("settings and local-loop diagnostics information architecture", () => {
  it("uses /settings/users as the only registered user-management route", () => {
    expect(app).toContain('path="/settings/users"');
    expect(app).not.toContain('path="/users"');
    expect(header).toContain('router.push("/settings/users")');
  });

  it("removes users and diagnostics from the top-level sidebar", () => {
    expect(nav).not.toContain('href: "/users"');
    expect(nav).not.toContain('href: "/system"');
  });

  it("redirects /system to the one-shot home dialog", () => {
    expect(app).toContain('path="/system" element={<Navigate to="/?dialog=diagnostics" replace />}');
    expect(header).toContain('label: "系统诊断"');
  });

  it("streams a fresh run and clears it on close", () => {
    expect(dialog).toContain('Accept: "application/x-ndjson"');
    expect(dialog).toContain("abortRef.current?.abort()");
    expect(dialog).toContain("setChecks([])");
    expect(dialog).not.toContain("setInterval");
  });
});
