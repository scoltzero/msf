# Third-party notices

MSF-authored code is distributed under the repository's GNU GPL v3.0 license.
The third-party code, data, and assets identified below retain their respective
upstream licenses and are not relicensed by this notice.

MSF 自有代码按照 GNU GPL v3.0 发布。下列已经标明的第三方代码、数据和
素材继续适用其各自的上游许可证，不因收录、调用或随 MSF 分发而被重新
许可。

## Provenance map

| MSF file scope | Source | Use | License or status |
|---|---|---|---|
| `internal/server/runtime_templates/mosdns/**` | yyysuo/mosdns, yyysuo/firetv, MetaCubeX/meta-rules-dat | MosDNS plugin configuration, runtime templates, and rule data | GPL-3.0 |
| `internal/server/runtime_templates/mihomo/config.yaml` | MetaCubeX/mihomo configuration schema and remote MetaCubeX rule providers | Generated default Mihomo configuration | Mihomo MIT; referenced rule sources retain their own terms |
| `web/src/components/mihomo/overview/earth/**` | Zephyruso/zashboard v3.18.0 | Earth renderer, route model, and GeoIP worker | MIT |
| `web/src/assets/images/earth/**` | Solar System Scope | Earth textures | CC BY 4.0 |
| `web/src/components/react-bits/GradientWaves.*` | React Bits | Animated WebGL background | MIT + Commons Clause |
| `web/src/components/react-bits/GlassSurface.*` | React Bits | Login and setup glass surfaces | MIT + Commons Clause |
| Optional browser download of DB-IP City Lite | DB-IP | User-consented IP geolocation | CC BY 4.0 |
| `logo_motion_mizar/**` and active Mizar exports | MSF maintainer prompt and selection, Codex image generation, nolangz/pixel2motion motion conversion | MSF identity and motion assets | Project brand policy; pixel2motion tool is MIT |

[`baozaodetudou/mssb`](https://github.com/baozaodetudou/mssb) was an early
publicly accessible functional reference for the combined MosDNS + Mihomo
workflow. It is recorded as a workflow reference, not as the license source
for MSF's Go code or for third-party configuration and rule material.

## MosDNS runtime templates and rule data

The MosDNS runtime templates and bundled rule artifacts under
`internal/server/runtime_templates/` use formats and extension plugins from
[`yyysuo/mosdns`](https://github.com/yyysuo/mosdns), and include configuration
or rule material distributed through
[`yyysuo/firetv`](https://github.com/yyysuo/firetv) and
[`MetaCubeX/meta-rules-dat`](https://github.com/MetaCubeX/meta-rules-dat).
Those upstream repositories are distributed under GNU GPL v3.0. The MSF
repository includes the GNU GPL v3.0 text in `LICENSE`.

Runtime JSON files may also point users to optional remote rule sources such
as [`Loyalsoldier/domain-list-custom`](https://github.com/Loyalsoldier/domain-list-custom).
Remote rule content is fetched only when enabled and remains subject to the
source repository's license and terms.

## Zephyruso/zashboard — global connections

The Mihomo “全球连接” renderer, route aggregation model, local GeoIP worker,
and related interaction behavior are adapted from
[Zephyruso/zashboard v3.18.0](https://github.com/Zephyruso/zashboard/tree/v3.18.0).

Copyright 2024 Zephyruso

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Earth textures

The Earth day, night, surface, and stars textures under
`web/src/assets/images/earth/` are resized/combined derivatives of the Solar
System Scope planet textures, carried from Zashboard v3.18.0.

- Source: https://www.solarsystemscope.com/textures/
- Creator: Solar System Scope
- License: Creative Commons Attribution 4.0 International
  https://creativecommons.org/licenses/by/4.0/

The node-material treatment is adapted from the Three.js WebGPU TSL Earth
example (Three.js, MIT License):
https://threejs.org/examples/webgpu_tsl_earth.html

## DB-IP City Lite

The application can download `dbip-city-lite@1.0.16` only after explicit user
consent. The database is not bundled with MSF. It is downloaded into and
queried from the user’s browser storage.

- Source: https://www.npmjs.com/package/dbip-city-lite/v/1.0.16
- Data provider: DB-IP.com, https://db-ip.com/db/lite.php
- License: Creative Commons Attribution 4.0 International
  https://creativecommons.org/licenses/by/4.0/

IP geolocation data provided by DB-IP.com.

## React Bits — GradientWaves

`web/src/components/react-bits/GradientWaves.tsx` and `GradientWaves.css` are
adapted from the JavaScript + CSS variant of
[React Bits GradientWaves](https://reactbits.dev/backgrounds/gradient-waves).

Copyright (c) 2026 David Haz

MIT + Commons Clause License Condition v1.0

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software as part of an
application, website, or product, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

Commons Clause Restriction: You may use this Software, including for any
commercial purpose, so long as you do not sell, sublicense, or redistribute the
components themselves, whether alone, in a bundle, or as a ported version.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## React Bits — GlassSurface

`web/src/components/react-bits/GlassSurface.tsx` and `GlassSurface.css` are
adapted from the JavaScript + CSS variant of
[React Bits GlassSurface](https://reactbits.dev/components/glass-surface).

Copyright (c) 2026 David Haz

MIT + Commons Clause License Condition v1.0

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, and distribute the Software as part of an
application, website, or product, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

Commons Clause Restriction: You may use this Software, including for any
commercial purpose, so long as you do not sell, sublicense, or redistribute the
components themselves, whether alone, in a bundle, or as a ported version.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## nolangz/pixel2motion

The Mizar raster concept selected by the MSF maintainer was converted into
motion-ready SVG and animated deliverables with
[`nolangz/pixel2motion`](https://github.com/nolangz/pixel2motion). The visual
requirements and prompt were supplied by the MSF maintainer, the initial image
was generated through Codex, and the maintainer selected and approved the
final identity and motion direction. Pixel2Motion is the conversion and motion
tool; it is not the source of the Mizar visual concept.

Copyright (c) 2026 Nolan Lai

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
