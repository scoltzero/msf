import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../app/mosdns/clients/page.tsx", import.meta.url), "utf8");
const style = readFileSync(new URL("../../app/mosdns/clients/clients.css", import.meta.url), "utf8");

describe("MosDNS client drag and drop", () => {
  it("binds the visible drag handle to native drag events", () => {
    expect(source).toContain("{onDragStart ? (");
    expect(source).toContain("draggable");
    expect(source).toContain('event.dataTransfer.setData("text/plain", key)');
    expect(source).toContain("data-client-drag-handle");
    expect(source).toContain("multiSelect || c.inClientList ? undefined");
  });

  it("renders a translucent drag banner and lifts the source card", () => {
    expect(source).toContain("createClientDragPreview");
    expect(source).toContain('preview.dataset.clientDragPreview = "true"');
    expect(source).toContain("event.dataTransfer.setDragImage(preview, 28, 24)");
    expect(source).toContain('dragging && "opacity-45 scale-[0.985]"');
    expect(source).toContain("dragOrigin === \"list\"");
    expect(source).toContain("dragOrigin === \"active\"");
  });

  it("supports moving clients into and out of the active list", () => {
    expect(source).toContain('onDrop={(event) => dropClient(event, activeListStatus)}');
    expect(source).toContain('onDrop={(event) => dropClient(event, "unscanned")}');
    expect(source).toContain("if (client.inClientList === movingIntoList) return;");
  });

  it("slides one persistent colored indicator between proxy modes", () => {
    expect(source).toContain("aria-pressed={isOn}");
    expect(source).toContain("mosdns-mode-switch__indicator");
    expect(source).toContain("Array.from({ length: 4 }");
    expect(source).toContain("if (nextMode === mode || modeUpdating) return;");
    expect(style).toContain("translate3d(calc(100% + 6px)");
    expect(style).toContain("translate3d(calc(200% + 12px)");
    expect(style).toContain("@keyframes mosdns-mode-light-drift");
    expect(style).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
