import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { updateSubscriptions } from "./updateSubscriptions";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
beforeEach(() => vi.mocked(api).mockReset());

describe("updateSubscriptions", () => {
  it("updates every HTTP subscription, skips local providers, and continues after failures", async () => {
    vi.mocked(api).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    const result = await updateSubscriptions([
      { name: "机场/甲", vehicleType: "HTTP" },
      { name: "local", vehicleType: "File" },
      { name: "failed", vehicleType: "http" },
      { name: "manual", vehicleType: "Inline" },
      { name: "last", vehicleType: "HTTP" },
    ]);
    expect(result).toEqual({ updated: 2, failed: ["failed"] });
    expect(vi.mocked(api).mock.calls).toEqual([
      [`/api/v1/mihomo/proxy-providers/${encodeURIComponent("机场/甲")}/update`, { method: "POST" }],
      ["/api/v1/mihomo/proxy-providers/failed/update", { method: "POST" }],
      ["/api/v1/mihomo/proxy-providers/last/update", { method: "POST" }],
    ]);
  });
});
