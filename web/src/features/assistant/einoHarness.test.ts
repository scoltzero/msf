import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("../../components/assistant/AssistantPanel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../components/assistant/assistant.css", import.meta.url), "utf8");
const settings = readFileSync(new URL("../../app/settings/AssistantSettingsCard.tsx", import.meta.url), "utf8");
const sse = readFileSync(new URL("./sse.ts", import.meta.url), "utf8");

describe("Eino assistant harness UI", () => {
  it("selects the per-session mode beside the composer", () => {
    expect(panel).toContain('value="read_only"');
    expect(panel).toContain('value="confirm_writes"');
    expect(panel).toContain('value="full_auto"');
    expect(panel).toContain("execution_mode: executionMode");
    expect(settings).not.toContain("settings.execution_mode");
  });

  it("resumes approval and rejection through the streaming Eino endpoint", () => {
    expect(panel).toContain('resumeApproval("approve")');
    expect(panel).toContain('resumeApproval("reject")');
    expect(sse).toContain("/resume/stream");
    expect(panel).not.toContain("result.result");
  });

  it("keeps the composer compact and reveals neutral scrollbars only while scrolling", () => {
    expect(styles).toContain("width: 4rem");
    expect(styles).toContain("width: 2.25rem");
    expect(styles).toContain(".assistant-panel .assistant-scroll-active::-webkit-scrollbar-thumb");
    expect(styles).toContain("scrollbar-color: transparent transparent");
    expect(panel).toContain("onScrollCapture={showScrollbarWhileMoving}");
    expect(styles).not.toContain('background: url("../../assets/assistant/ler-sent001-orb-poster.png")');
    expect(settings).toContain("text-lg font-semibold");
    expect(settings).toContain('className="h-5 w-5 accent-primary"');
  });
});
