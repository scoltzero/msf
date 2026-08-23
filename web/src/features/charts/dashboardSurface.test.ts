import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const card = readFileSync(new URL("../../components/dashboard/DashboardCard.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../components/dashboard/DashboardCard.css", import.meta.url), "utf8");

describe("dashboard widget surface", () => {
  it("removes the clipped outer shadow only from dashboard widget cards", () => {
    expect(card).toContain("data-dashboard-widget-card");
    expect(styles).toContain(".gary-glass[data-dashboard-widget-card]");
    expect(styles).toContain("--gary-local-shadow: none");
    expect(styles).toContain("box-shadow: none");
  });
});
