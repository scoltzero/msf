import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../app/mosdns/query-log/page.tsx", import.meta.url), "utf8");

describe("MosDNS query log result visibility", () => {
  it("shows DNS answers in a dedicated compact result column", () => {
    expect(page).toContain('{ label: "查询结果"');
    expect(page).toContain('className="w-full min-w-[1120px] table-fixed text-sm"');
    expect(page).toContain('<col className="w-[24%]" />');
    expect(page).toContain('<col className="w-[11%]" />');
    expect(page).toContain("formatAnswerItem");
    expect(page).toContain('textValue(answer, ["data", "value", "answer", "ip", "target"])');
    expect(page).not.toContain("TTL ${ttl}s");
    expect(page).not.toContain('textValue(answer, ["type", "record_type", "qtype"])');
    expect(page).toContain(".replace(/^\\s*(?:A|AAAA|CNAME|HTTPS|SVCB|TXT|MX|NS|PTR|SOA)");
    expect(page).toContain("未记录应答");
  });

  it("includes returned answers in query-log search", () => {
    expect(page).toContain('${r.domain}${r.client}${r.answer || ""}');
    expect(page).toContain("r.answer === query");
  });
});
