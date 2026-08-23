# MSF Mizar Brand Assets

This directory is the single home for Mizar source artwork, motion work, QA evidence, and generated delivery assets. The maintained master geometry is `source/msf-mizar.svg`; `source/selected-concept.png` preserves the raster concept selected by the maintainer. The visual requirements and prompt were supplied by the MSF maintainer, Codex generated the initial raster image, and the maintainer selected and approved the final visual direction. The MIT-licensed [`nolangz/pixel2motion`](https://github.com/nolangz/pixel2motion) workflow was then used to fit the selected raster into motion-ready SVG and animated deliverables.

All active raster outputs are generated from the maintained SVG by `scripts/brand/generate-mizar-brand-assets.cjs`; do not redraw or simplify the folds manually. Brand-use boundaries are documented in [`BRAND_POLICY.md`](../BRAND_POLICY.md).

## Directory layout

- `source/`: canonical SVG geometry and the selected raster concept.
- `orbit_weave_v2/`: current motion source, deterministic captures, reports, and QA frames.
- `exports/`: generated delivery assets and their checksums.

## Asset groups

- `exports/vector/`: canonical SVG copied into the delivery set.
- `exports/transparent/`: transparent PNG exports from 16px through 2048px.
- `exports/favicon/`: cropped SVG, 16/32/48px PNGs, and a multi-size ICO.
- `exports/app-icon/`: white rounded-square application icons with transparent outer corners.
- `exports/unraid/`: transparent 256px CA icon and 128px local plugin icon.
- `exports/motion/`: approved ribbon-orbit animation in SVG, WebP, and GIF formats.
- `exports/SHA256SUMS`: integrity hashes for all generated delivery assets.

## Regeneration

The generator requires Node.js and Sharp:

```sh
node scripts/brand/generate-mizar-brand-assets.cjs
```

The generated assets are also copied into their active Web, macOS, fnOS/root, and Unraid locations.
