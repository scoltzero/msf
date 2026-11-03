import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  function fallback(result = true) {
    const textarea = { value: "", style: {}, select: vi.fn(), remove: vi.fn() };
    const execCommand = vi.fn(() => result);
    vi.stubGlobal("document", { activeElement: null, createElement: () => textarea, body: { appendChild: vi.fn() }, execCommand });
    vi.stubGlobal("HTMLElement", class {});
    return { textarea, execCommand };
  }

  it("uses the modern clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyText("custom-secret");
    expect(writeText).toHaveBeenCalledWith("custom-secret");
  });

  it.each([false, true])("copies on HTTP or when the clipboard API rejects (rejected=%s)", async (rejected) => {
    vi.stubGlobal("navigator", rejected ? { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } } : {});
    const { textarea, execCommand } = fallback();
    await copyText("generated-secret");
    expect(textarea.value).toBe("generated-secret");
    expect(textarea.select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalled();
  });

  it("reports failure and removes the temporary secret instead of claiming success", async () => {
    vi.stubGlobal("navigator", {});
    const { textarea } = fallback(false);
    await expect(copyText("secret")).rejects.toThrow("复制失败");
    expect(textarea.remove).toHaveBeenCalled();
  });
});
