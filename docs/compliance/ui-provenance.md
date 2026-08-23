# UI provenance and functional-boundary record

This record describes the current MSF WebUI, built on the clean v0.5.0 public
baseline and prepared for the v0.6.0 release. It is an engineering provenance
record, not a claim that generic user
interface patterns are exclusively owned by MSF and not a legal opinion.

## Current implementation

- Framework: React 19, TypeScript, and Vite; see `web/package.json`.
- Application shell: `web/src/components/AppShell.tsx`, `Sidebar.tsx`,
  `MobileNav.tsx`, and `AppHeader.tsx`.
- Visual system: the MSF Liquid Glass components and styles under
  `web/src/components/liquid-glass/` and `web/src/styles/liquid-glass-*.css`.
- Brand: the Mizar source artwork, generated exports, and checksums under
  `logo_motion_mizar/`.
- Login presentation: `web/src/app/login/page.tsx` and
  `web/src/components/login/LoginLogoShowcase.tsx` using Mizar assets.
- Backend: Go handlers and configuration generation under `cmd/msf/` and
  `internal/server/`, maintained as part of this repository.

## Public functional reference and reimplementation boundary

The publicly accessible `baozaodetudou/mssb` implementation was an early
functional reference for the combined MosDNS + Mihomo workflow. MSF used Go to
reimplement, redesign, optimize, and extend the management backend and control
plane. The current audit found no original mssb Shell/Python program source in
the MSF repository and no line-by-line translation of that program code.
Shared fields, plugin types, ports, rule formats, and required processing steps
are filtered as common-upstream interfaces, functional constraints, standard
syntax, or configuration with limited practical expression. File-level
third-party sources and licenses are recorded in `THIRD_PARTY_NOTICES.md`.

## Functional filtering matrix

| Surface | Shared or function-constrained material | Current MSF implementation or licensed increment |
|---|---|---|
| Application navigation | Route names, service categories, responsive sidebar and mobile navigation are common administration patterns. | `AppShell.tsx`, `Sidebar.tsx`, `MobileNav.tsx`, and the MSF Liquid Glass styling. |
| Login | Username/password fields, submit state, validation, and session handling are dictated by authentication behavior. | MSF React page structure, Mizar artwork, `LoginLogoShowcase.tsx`, and the current motion treatment. |
| Dashboard | CPU, memory, traffic, DNS, and connection metrics originate in runtime APIs and use common chart conventions. | MSF widget registry, configurable grid, collections, error boundaries, sampling logic, and Liquid Glass presentation. |
| MosDNS management | Field names, plugin tags, ports, switches, rule formats, and status values are constrained by MosDNS and the installed configuration. | MSF React panels, Go API handlers, validation, persistence, hot synchronization, and responsive layout. |
| Mihomo management | Controller endpoints, proxy/rule fields, provider state, and connection data are defined by Mihomo compatibility. | MSF configuration-authority model, editors, transactions, tests, and page composition. Identified Zashboard-derived code is MIT-licensed and recorded in `THIRD_PARTY_NOTICES.md`. |
| Tables, forms, switches, dialogs, and logs | These are standard controls whose labels and values frequently follow the underlying API or configuration schema. | MSF component composition, responsive behavior, localization, error handling, and project-specific visual tokens. |
| Brand and icons | Product identification is not required by the shared backend. | The maintainer supplied the Mizar requirements and prompt, selected the Codex-generated concept, and used MIT-licensed pixel2motion for SVG fitting and motion output. Source geometry, generated assets, QA evidence, and SHA-256 records are retained; use boundaries are in `BRAND_POLICY.md`. Lucide and other dependencies remain subject to their own licenses. |

## Comparison method

Any similarity review should identify a concrete file or rendered element and
then filter, in this order:

1. material required by MosDNS, Mihomo, HTTP, YAML, or another upstream API;
2. standard administration controls and layouts with limited practical forms;
3. material supplied under an identified third-party license;
4. user-generated configuration, rules, labels, or subscription data; and
5. the remaining project-specific code, artwork, wording, composition, and
   motion.

A conclusion about one historical file or one third-party component should not
be generalized to the independently maintained Go backend or the current React
WebUI without a file-specific comparison.

## Repository controls

The public history was restarted at the clean v0.5.0 baseline. The compliance
audit rejects known private comparison exports, historical third-party UI
captures, and legacy logo reference archives if they are reintroduced as
tracked files. Private preservation material is not part of the public
repository.
