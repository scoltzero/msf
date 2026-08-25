# Repository scripts

The scripts are grouped by the workflow that owns them. They are invoked by
the Makefile or GitHub Actions and are not runtime dependencies of an installed
MSF instance.

| Path | Purpose | Invoked by |
| --- | --- | --- |
| `brand/generate-mizar-brand-assets.cjs` | Regenerates Mizar SVG, PNG, ICO, WebP, GIF, and Web assets from the canonical source geometry. | Manual brand maintenance |
| `compliance/audit-compliance.sh` | Rejects retired identifiers, private comparison artifacts, known live samples, unsafe proxy URLs, and prohibited strings in generated artifacts. | `make audit-compliance` |
| `release/smoke-factory-reset.sh` | Runs a candidate native binary in an isolated temporary data directory and verifies nft-to-TUN reinitialization and Factory Reset behavior. | Release workflow |
| `release/verify-release-assets.sh` | Verifies the Linux amd64 tarball checksum, ELF architecture, and embedded commit/tag provenance. | `make verify-release-assets` |

Run scripts through their owning Make target or workflow where possible so all
required arguments and host capabilities are supplied consistently.
