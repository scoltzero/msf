#!/usr/bin/env python3
"""Check deterministic frame-to-frame continuity across a Pixel2Motion risk window."""

from __future__ import annotations

import argparse
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("html", type=Path)
    parser.add_argument("--window", default="760:1320:20")
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--chrome", default="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    args = parser.parse_args()

    start, end, step = (int(value) for value in args.window.split(":"))
    times = list(range(start, end + 1, step))
    frames: list[np.ndarray] = []
    base_url = args.html.resolve().as_uri()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chrome)
        page = browser.new_page(viewport={"width": 900, "height": 900}, device_scale_factor=1)
        for time_ms in times:
            page.goto(f"{base_url}?t={time_ms}")
            page.wait_for_function("window.__p2mReady === true")
            png = page.locator("#logo-root").screenshot()
            frames.append(np.asarray(Image.open(io.BytesIO(png)).convert("RGB"), dtype=np.int16))
        browser.close()

    rows = []
    changed_values = []
    for index in range(1, len(frames)):
        delta = np.abs(frames[index] - frames[index - 1])
        changed = int(np.any(delta >= 5, axis=2).sum())
        mean_abs = float(delta.mean())
        changed_values.append(changed)
        rows.append({
            "from_ms": times[index - 1],
            "to_ms": times[index],
            "changed_pixels_ge_5": changed,
            "mean_abs_diff": round(mean_abs, 6),
        })

    median_changed = float(np.median(changed_values)) if changed_values else 0.0
    stalls = [
        row for row in rows
        if row["changed_pixels_ge_5"] <= max(8, median_changed * 0.03)
    ]
    report = {
        "html": str(args.html),
        "window": args.window,
        "median_changed_pixels": median_changed,
        "samples": rows,
        "near_static_samples": stalls,
        "continuity_pass": not stalls,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"median changed pixels: {median_changed:.0f}")
    print(f"near-static samples: {len(stalls)}")
    for row in stalls:
        print(f"  {row['from_ms']}->{row['to_ms']}ms: {row['changed_pixels_ge_5']} changed px")
    print(f"continuity pass: {not stalls}")
    print(f"report -> {args.report}")
    return 0 if not stalls else 1


if __name__ == "__main__":
    raise SystemExit(main())
