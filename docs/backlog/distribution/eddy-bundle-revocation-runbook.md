---
area: distribution
status: ready
title: Verified bundle revocation runbook (object delete + CDN purge)
created: 2026-07-10
why: the immutable S3 tier + CDN serve a closure effectively forever; npm unpublish/malware pulls need a documented, verified operator revoke path — and the stale-pin window makes this the explicit safety net
user_story: As the eddy operator learning that a bundled package version was pulled from npm, I want a verified procedure that stops serving the affected bundle, but today no doc names the steps and the CDN edge would keep serving it up to a year.
epic: install-tail-latency
blocked_by: []
sources: [docs/public/hosting-eddy.md]
code: [services/eddy/src/s3-bundle-store.ts, services/eddy/src/cache.ts]
---

## Context

Revocation mechanics already work in code: bucket object gone → store miss →
origin `GET /bundle/<hash>` 404 `no-store` → pinned client falls back to POST →
fresh resolve re-seeds (tested). What is missing is the operator path: the
exact delete command (raw-slash key caveat — base64 `/` stays raw in the S3
key), the CDN purge step (edge holds `immutable, max-age=31536000`), and a
verified end-to-end proof. Without the purge step a naive `rm` silently keeps
the bundle live at the edge.

## Acceptance

- `docs/public/hosting-eddy.md` gains a §Revocation runbook with exact
  commands: (1) object delete of `bundle/<closureHash>` (raw-slash key named),
  (2) CDN cache purge for that path on the live CDN resource, (3) verification:
  origin GET → 404 `no-store`, CDN GET → no longer the old bytes, (4) client
  behavior statement: pinned/stale-pinned clients fall back to POST and re-seed
  a fresh resolve, (5) honest residual: browser HTTP caches may hold the bundle
  until eviction — named, not hidden.
- The runbook is executed once against a throwaway closure on the live deploy
  (scratch dep-set → resolve → delete → purge → origin 404 → POST re-seed 200)
  and the run is recorded in the runbook (date + observed statuses).
- Steps are ordered so the verify step catches a forgotten purge.

## Parity cases

N/A — operator documentation; no Node-observable runtime behavior.

## Fault matrix

| Fault | Expected outcome | Proof |
|---|---|---|
| Object deleted, CDN purge skipped | verify step fails loudly (CDN still serves old bytes) → runbook orders purge before done | live verification run |
| CDN purge API unavailable | runbook names it a hard requirement — no silent fallback; escalation path documented (re-point/replace CDN resource) | doc review |
| Client holds a pin to the revoked hash | GET 404 → foreground POST → fresh resolve re-seeds; pin replaced on learn | existing 404-fallback tests, referenced |

## Out of scope

- Automated revocation tooling or an eddy admin endpoint.
- Scanning npm for unpublished/pulled versions.
- Purging or invalidating browser HTTP caches.

## Decisions

- REVERSIBLE — documentation + one live verification; no ADR.
- Runbook lives in `docs/public/hosting-eddy.md` (the single operator doc), not
  a new file.
