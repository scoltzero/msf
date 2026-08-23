"use client";

import { GlassSurface } from "@/components/liquid-glass/GlassSurface";
import { TIME_WINDOW_OPTIONS, type TimeWindowSeconds } from "./timeSeries";

export function TimeWindowSelector({
  value,
  onChange,
}: {
  value: TimeWindowSeconds;
  onChange: (value: TimeWindowSeconds) => void;
}) {
  return (
    <GlassSurface
      material="regular"
      flat
      className="gary-segmented flex w-[17rem] max-w-full min-w-0 shrink-0 items-center gap-0.5 overflow-hidden p-1"
      role="group"
      aria-label="图表时间范围"
      data-time-window-selector
    >
      {TIME_WINDOW_OPTIONS.map((seconds) => (
        <button
          type="button"
          key={seconds}
          onClick={() => onChange(seconds)}
          aria-pressed={seconds === value}
          title={`观察最近 ${seconds} 秒`}
          className={
            "gary-segmented__item min-w-0 flex-1 px-1.5 py-1.5 text-[10px] font-medium " +
            (seconds === value ? "gary-segmented__item--active text-primary" : "text-muted-foreground")
          }
        >
          {seconds}s
        </button>
      ))}
    </GlassSurface>
  );
}
