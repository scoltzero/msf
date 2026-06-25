# MSM Free Logo Motion Spec

## Source

- Input: `/Users/luochuhan/repo/msm-free/logo.png`
- Source file header: JPEG image data despite `.png` extension
- Canvas: 1024 x 1024, white background
- Semantic parts: `m-original`, `branch-left-original`, `branch-right-original`

## Motion Brief

- Personality: friendly, technical, connected
- Usage context: splash-style reveal ending in the static logo
- Pattern: pen-like M draw reveal plus staggered branch reveal
- Timeline: 1800 ms total, roughly 20% anticipation, 50% reveal/action, 30% settle
- Easing: confident ease-out for the M layer; soft staggered settle for the S/F branch layers

## Geometry Notes

This pass keeps the logo shape from the original raster rather than approximating it with hand-written SVG paths. The earlier stroked-path reconstruction changed the silhouette and made the `M` look asymmetric, so the logo is now split into original-shape transparent image layers placed back at source coordinates:

- The large M is `#m-original`, a transparent PNG cut from the source logo and placed at `x=313 y=205 w=399 h=361`.
- The orange S branch is `#branch-left-original`, placed at `x=213 y=504 w=303 h=319`.
- The green F branch is `#branch-right-original`, placed at `x=508 y=504 w=303 h=313`.
- Animation changes only opacity, clipping, mask stroke progress, and transform timing. The final logo shape is not redrawn. The M is revealed by an SVG mask stroke following the centerline from the lower-left leg, through the valley, to the lower-right leg.

## QA Plan

- Render SVG over the source raster to inspect scale and gross silhouette.
- Build showcase HTML with `scripts/animate_svg_showcase.py`.
- Capture deterministic frames at choreography beats: 0, 250, 500, 800, 1100, 1400, 1800 ms.
- Export an animated GIF from deterministic frames for quick preview.
