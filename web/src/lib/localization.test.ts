import { describe, expect, it } from "vitest";
import { translateText } from "./localization";

describe("English localization", () => {
  it("restores core navigation and MosDNS rule labels", () => {
    expect(translateText("规则管理")).toBe("Rules");
    expect(translateText("广告拦截规则")).toBe("Ad-blocking sources");
    expect(translateText("在线分流规则")).toBe("Online routing sources");
    expect(translateText("上次更新")).toBe("Last updated");
  });

  it("translates dynamic client status text", () => {
    expect(translateText("5 分钟前")).toBe("5 minutes ago");
    expect(translateText("上次扫描 5 分钟前")).toBe("Last scan 5 minutes ago");
    expect(translateText("多选 (3)")).toBe("Select multiple (3)");
  });

  it("translates the automatic provider path guidance", () => {
    expect(translateText("留空时自动使用")).toBe("Leave blank to use");
    expect(translateText("，也可以自定义相对路径。")).toBe(", or enter a custom relative path.");
  });

  it("translates the ALIAPI credential editor", () => {
    expect(translateText("阿里云 API 配置")).toBe("Aliyun API Settings");
    expect(translateText("账户 ID")).toBe("Account ID");
    expect(translateText("已设置，留空则保持不变")).toBe("Already set; leave blank to keep it unchanged");
    expect(translateText("范围 0–128，通常使用 32")).toBe("Range 0–128; 32 is typical");
  });
});
