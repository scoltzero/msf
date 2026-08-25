import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMarkdown, splitTrailingJson } from "@/components/assistant/AssistantMarkdown";

describe("AssistantMarkdown", () => {
  it("renders GFM formatting and blocks executable HTML or unsafe links", () => {
    const content = '## Result\n\n**Healthy**\n\n| Service | State |\n| --- | --- |\n| MosDNS | ok |\n\n[unsafe](javascript:alert(1))\n\n[protocol relative](//evil.example)\n\n![remote](https://tracker.example/pixel.png)\n\n<script>alert(1)</script>';
    const html = renderToStaticMarkup(createElement(AssistantMarkdown, { content }));
    expect(html).toContain("<h2>Result</h2>");
    expect(html).toContain("<strong>Healthy</strong>");
    expect(html).toContain("<table>");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("//evil.example");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
  });

  it("folds a valid trailing JSON object instead of rendering it as prose", () => {
    const content = '诊断完成，发现以下结果：\n{"status":"ok","evidence":"line 1\\nline 2"}';
    expect(splitTrailingJson(content)).toEqual({ markdown: "诊断完成，发现以下结果：", json: { status: "ok", evidence: "line 1\nline 2" } });
    const html = renderToStaticMarkup(createElement(AssistantMarkdown, { content }));
    expect(html).toContain("诊断完成，发现以下结果：");
    expect(html).toContain("<summary>查看原始数据</summary>");
    expect(html).not.toContain('结果：\n{&quot;status&quot;');
  });
});
