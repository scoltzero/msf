# Login Logo Showcase

Reference: `http://192.168.10.3:7777/login`

Scope:
- Recreate the animated left-side login logo cluster while keeping the existing MSM login form behavior unchanged.
- Use the current transparent MSM raster logo at `/logo/logo-square.png`.
- Match the reference structure: a white/dark rounded logo card, a translucent rotating blue square inside the card, three orbit rings, dashed flow paths, top/left/right flow particles, background glows, and a center pulse.
- Provide a compact mobile version so the logo treatment remains visible when the desktop left panel is hidden.

Animation targets:
- Logo card floats upward and tilts in a 4 second loop.
- Inner translucent square rotates continuously over 16 seconds.
- Orbit rings rotate over 10, 15, and 20 seconds, with the middle ring reversing direction.
- Flow particles loop over 4 seconds with staggered delays matching the reference cadence.
- SVG dashed paths move continuously over 1.5 seconds.
- Reduced-motion users see the static composition without looping motion.
