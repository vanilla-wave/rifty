---
area: distribution
status: active
title: License/positioning artifact + honest compat-matrix as the pitch
created: 2026-06-11
why: the open-licensing wedge is rifty's core M11 positioning, but nothing verifies the LICENSE is MIT/Apache end-to-end, compares vs the incumbents, or ships the honest compat-matrix that IS the pitch
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0071]
code: [LICENSE, docs/public/compat]
---

## Context

rifty's M11 (Consumer Ready) wedge is openness, not browser capability — the platform ceilings are
shared with WebContainers. The incumbents are all gated: WebContainers' runtime is proprietary +
metered (commercial prod needs a paid licence; free cap ~500 sessions/mo or 10k req/mo; self-host /
private-registry = Enterprise; the MIT `webcontainer-core` repo is only a client shim loading code
from StackBlitz servers). Nodebox is Sustainable-Use (no commercial embed) and stalled since
2023-11. CheerpX/WebVM's engine is proprietary + CDN-locked. rifty is MIT on royalty-free web
standards and self-hostable — an essentially uncontested quadrant. But no work funds the
positioning. See `docs/research/open-webcontainers-alternative-2026-06.md`.

## Options or Next

- Audit the repo LICENSE + every dependency licence end-to-end; flag any copyleft / source-available
  surface that would undercut the MIT/Apache claim.
- Write a side-by-side comparison page (under `docs/public`) vs WebContainers / Nodebox / CheerpX —
  terms, not vibes.
- Regenerate + foreground the compat-matrix as the honest capability claim ("good enough for Express
  + Vite + npm install, fully open"); link it from the README.
- Failure mode: overclaiming Node parity. Keep the matrix honest — loud-throw stubs stay visible.

## Reversibility

REVERSIBLE — docs + a licence audit; no package public API. Recorded here.
