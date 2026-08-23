import { describe, expect, it } from "vitest";
import { sanitizeProxyProviderName, suggestedProxyProviderPath } from "./providerPath";

describe("proxy provider path suggestions", () => {
  it("uses the provider name for the default local path", () => {
    expect(suggestedProxyProviderPath("kuromis")).toBe("./proxy_providers/kuromis.yaml");
    expect(suggestedProxyProviderPath("机场 A")).toBe("./proxy_providers/机场-a.yaml");
  });

  it("removes path separators and falls back for an empty name", () => {
    expect(sanitizeProxyProviderName(" ../Home|Lab/ ")).toBe("home-lab");
    expect(suggestedProxyProviderPath("   ")).toBe("./proxy_providers/provider.yaml");
  });
});
