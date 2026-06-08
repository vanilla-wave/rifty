---
area: net
status: active
title: Streaming cross-realm preview for large Vite responses — confirm closed vs residual buffered-fallback
created: 2026-06-08
why: docs/ROADMAP.md marks it ⏳ open, but ADR-0048 added streaming wire-frames (v2) — confirm before dropping
sources: [PROJECT_PLAN (⏳ open), ADR-0048, ADR-0017]
---
## Context
docs/ROADMAP.md marks "streaming cross-realm preview for large Vite responses" ⏳ open, but the repo shows ADR-0048 already added the net-local `PREVIEW_PORT_FRAME_VERSION` '1'→'2' streaming wire-frames (additive streaming frames + per-request reply-mode selection) over the ADR-0043 D2 buffered preview hop. So the status is ambiguous: the v2 streaming frames shipped, but the page side still reassembles buffered (no true cross-realm backpressure until the M12 ReadableStream rewrite under ADR-0017). Needs confirmation of what's closed vs residual.

## Options / Next
Next: confirm whether ADR-0048's v2 streaming frames fully close this docs/ROADMAP.md row, or whether residual buffered-fallback work remains (the page-reassembly ceiling). If closed → mark the docs/ROADMAP.md entry done. If residual → it is the M12/ADR-0017 end-to-end ReadableStream rewrite (a separate, perf-area-owned item — do not duplicate here). Distinct from the perf-plan ADR-0093 page↔worker streaming rewrite.

## Reversibility
REVERSIBLE — a status reconciliation / doc confirm. The residual end-to-end rewrite (if any) is the M12/ADR-0017 deferral (IRREVERSIBLE wire bump, owned elsewhere). Recorded against ADR-0048/ADR-0017.
