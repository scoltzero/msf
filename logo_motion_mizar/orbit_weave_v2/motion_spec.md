# MSF Mizar — Orbit Weave Motion v2

## Direction

This revision replaces the generic layer translation with a bespoke ribbon narrative.

- **Motion words:** orbital, interwoven, precise.
- **Brand metaphor:** MosDNS and Mihomo are two independent engines moving in a coupled orbit, like Mizar's double-star system.
- **Visual rule:** viewers must see two physical ribbon actors before seeing the finished logo.
- **Final-state rule:** the original logo paths, gradients, folds, shadow, proportions, and transparent exterior remain untouched.

## Cast

| Actor | SVG ID / class | Function |
| --- | --- | --- |
| Temporary motion stage | `motion-ribbons` | Contains all cinematic construction geometry; base opacity is 0 |
| Blue orbit ribbon | `orbit-blue-ribbon`, `.orbit-blue-track` | First moving ribbon / near orbit |
| Cyan orbit ribbon | `orbit-cyan-ribbon`, `.orbit-cyan-track` | Second moving ribbon / delayed counter-orbit |
| Crossing order | `orbit-blue-ribbon`, `orbit-cyan-ribbon` | Cyan passes in front at the orbit crossing; the blue ribbon remains visibly continuous behind it |
| Blue formation spine | `weave-blue-ribbon`, `.weave-blue-track` | Draws from the central crossing through the left ribbon to the lower join |
| Cyan formation spine | `weave-cyan-ribbon`, `.weave-cyan-track` | Draws from the same crossing through the right ribbon to the lower join |
| Verified final logo | `logo-geometry` | Original production geometry, revealed only after the weave is legible |

All draw paths use `pathLength="1"` for normalized dash timing.

## 2200 ms shared timeline

| Time | Beat | Motion |
| ---: | --- | --- |
| 0–220 ms | Empty-space anticipation | A short clean hold; no cap dot or accidental ink is visible. |
| 220–920 ms | Coupled orbit | Blue and cyan ribbon segments enter on mirrored long arcs. Cyan trails by 66 ms and passes in front at the designed crossing. |
| 660–1540 ms | Alignment and draw-on | Each orbiting ribbon transfers into a wide centerline that echoes its final filled half. The blue and cyan draws overlap instead of handing off on one frame. |
| 1160–1870 ms | Solidification | The verified filled logo grows outward from the existing center crossing while the temporary stroked ribbons dissolve. |
| 1870–2200 ms | Exact settle | The final 0.8% scale overshoot resolves to `transform:none`; temporary actors return to base opacity 0. |

The longer action phase is intentional: the user requested a readable interwoven-ribbon construction, so orbit and formation need to remain visible long enough to be understood. The final settle stays restrained and short.

## Principles

- **Staging:** orbit first, alignment second, filled logo last.
- **Arcs:** the primary action is built from mirrored orbital Bézier trajectories rather than diagonal translations.
- **Overlapping action:** cyan trails blue; orbit, formation, and solidification overlap across separate windows.
- **Solid drawing:** ribbon widths stay uniform under motion; temporary paths do not deform the verified logo.
- **Slow in / slow out:** narrative cubic Béziers are literal inside every keyframe.
- **Timing:** one 2200 ms clock keeps QA seeking deterministic.
- **Follow-through:** only the finished filled mark receives a restrained 0.8% overshoot.
- **Appeal:** mirrored orbital ribbons and a two-stage stroke-to-fill resolution make this motion specific to the Mizar mark.

## Final Frame Contract

At `t=2200ms`:

- `motion-ribbons` and all construction strokes are invisible;
- `logo-geometry` is `opacity:1`, `transform:none`, and `clip-path:none`;
- `connection-glint` remains at its SVG base opacity 0, so no dot is introduced;
- all original production geometry and presentation attributes remain unchanged;
- `?static=1` and `?t=2200` must have an exact same-pipeline pixel diff of zero.
