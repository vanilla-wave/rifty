# ADR 0160: Window owner ports and anti-hijack ready-frame routing

Status: Accepted
Date: 2026-06

> TL;DR: window owners advertise a `ports` field so falsy-clientId preview
> traffic routes port-keyed over the READY windows owning the port (symmetric
> with ADR-0123 worker scoping), the SW rejects `rifty:preview:ready` from any
> client it has served a `/preview/<port>/` document to, and all SW preview
> error responses carry cross-origin-isolation headers — `SW_ROUTING_VERSION`
> `3`→`4`.

## Context

Soft Panels copies the real preview URL (`<origin>/preview/<port>/`); pasted
into a fresh tab it failed (cross-tab-preview-routing backlog). The live owner
is a **window** (the page bridge; the Real-Vite worker path is the worker case
ADR-0123 already covers, and in prod the worker is a no-op) — so worker
port-keying (ADR-0123) does not reach it. Two real defects plus an open
auth gap:

- **(a) COEP-less error frame.** SW preview error responses (503/502) carried
  no COEP/CORP → iframed under credentialless COEP they fail
  `ERR_BLOCKED_BY_RESPONSE` (verified 2026-06-11) instead of degrading to a
  visible 503.
- **(b) Windows ignore port.** A window owns every page-registered port; with
  multiple playground windows a falsy-clientId fetch routes to the
  most-recently-focused ready window regardless of which window owns the port →
  multi-window misroute.
- **(c) Unauthenticated window ready frame** (preview-owner-window-auth
  backlog). `owner-binding-window.ts` keys `rifty:preview:ready` on
  `ev.source.id` with no auth; a previewed app posts a fake ready, defeats the
  ADR-0130 URL filter via `history.pushState` (filter reads mutable
  `client.url`), wins the no-clientId fallback, and reads request frames.

## Decision

EXTENDS ADR-0040 (`SW_ROUTING_VERSION` owns owner-fallback); does **not**
overturn it. Builds on the ADR-0123 `(ownerToken, port)` worker precedent and
the ADR-0125 clientId sentinel trichotomy.

### 1. COEP on all SW preview error responses

Every SW preview error response (503/502) carries CORP `cross-origin` + COEP
`credentialless`, so a foreign-tab failure renders an honest 503 page under the
credentialless-COEP iframe instead of a blocked frame. Fixes (a). **No version
bump** — response headers are not a routing or frame-shape contract.

### 2. Window owners advertise `ports`; port-keyed window routing

Window owners gain an **additive-optional** `ports` field on
`rifty:preview:ready`/`goodbye`. For falsy-clientId preview traffic (`''`
embedded / `null` copied-top-level, ADR-0125) the SW resolves port-keyed over
READY windows owning the port:

- exactly one ready window owns the port → route to it;
- multiple → 503 (refuse to guess — isolation, **symmetric with ADR-0123**
  worker `(ownerToken, port)` scoping);
- a window advertising **no** `ports` keeps the legacy ready-window fallback
  (ADR-0125) — back-compat for page-owned Dev Mode that sends none.

Fixes (b). Real cross-tab preview: the copied tab's subresources resolve to the
single playground window owning that port.

### 3. Anti-hijack: reject ready from SW-served preview documents

The SW records, per client, every `/preview/<port>/` document it has served, in
a dedicated `previewDocumentClients` set. A `rifty:preview:ready` from any such
client is rejected. This is a **superior variant of preview-owner-window-auth
option 2**: keyed on the SW-served-navigation **fact**, not the mutable
`client.url`, so `history.pushState` cannot defeat it (option 2 captured URL at
fetch time; this needs no capture — the SW itself committed the navigation).

The membership set is **separate from the routing frame-context LRU and pruned
by liveness** (`clients.matchAll`), not insertion order: a prune only drops
clientIds the SW no longer controls, so a **live** preview document is never
dropped and can never reclaim the bridge after churn. This decouples the
auth gate from the frame-context eviction policy
(preview-frame-context-lifecycle) — **fully closing preview-owner-window-auth**,
not just mitigating it.

Option 1 (require the page's `ownerToken` on window ready frames) alone is
**insufficient**: the SW has no pre-shared secret to validate a window token
against, and the mock dev path posts none — a token field the SW cannot
authenticate is theatre. The served-navigation fact is something the SW knows
first-hand. Fixes (c).

### 4. Versions

`SW_ROUTING_VERSION` `3`→`4`: window port-keying (rule 2) and the anti-hijack
ready rejection (rule 3) are **wire-observable** routing rules — a peer that
disagrees misroutes or mis-rejects. `SW_FRAME_VERSION` stays `1`: `ports` on
the window ready frame is additive-optional with a documented default (ADR-0031
rule, restated ADR-0040). Producer (playground page bridge) and consumer (SW)
both import the constant → lockstep; a stale peer 503s via the structured
`(frame, routing)` mismatch already in place (ADR-0040).

## Consequences

- Positive: real cross-tab preview (paste a `/preview/<port>/` URL into a fresh
  tab); multi-window port isolation for **window** owners (symmetric with the
  worker isolation ADR-0123 already gave); closes the window-auth hijack
  (preview-owner-window-auth); honest 503/502 failures under credentialless
  COEP instead of `ERR_BLOCKED_BY_RESPONSE`.
- Negative: a forced routing-version bump → a brief SW/page skew window during
  upgrade (fresh SW + un-reloaded page, or vice-versa). Mitigated by the
  existing `(frame, routing)` mismatch → 503 path (ADR-0040): stale peers fail
  loud, not silent.
- Closes **preview-owner-window-auth**: the liveness-pruned
  `previewDocumentClients` set makes rule 3 independent of the routing
  frame-context eviction — a live preview document is never dropped, so there is
  no eviction-reexposure residual. The routing-side
  preview-frame-context-lifecycle item (LRU eviction downgrading copied-top-level
  routing) stays separate and open; it no longer carries a security stake.
- Follow-up: mock devMode windows without an `ownerToken` are still port-keyed
  via `ports` (rule 2) — `ports` carries the routing, no secret required.

## Cited ADRs and references

- ADR-0040 — `SW_FRAME_VERSION` / `SW_ROUTING_VERSION` split; owner-fallback
  lives under routing. This ADR bumps routing `3`→`4`.
- ADR-0123 — `(ownerToken, port)` worker scoping; window port-keying (rule 2)
  is the symmetric window-side rule.
- ADR-0125 — clientId sentinel trichotomy (`id` / `''` / `null`); ready-window
  preference that the no-`ports` window fallback preserves.
- ADR-0097 — frame port context the served-navigation record extends.
- ADR-0130 — preview-document URL filter; this ADR's served-navigation fact
  replaces its `client.url` reliance for the auth gate.
- Affected files: `packages/service-worker/src/protocol.ts`
  (`SW_ROUTING_VERSION` 4 + bump-trigger TSDoc),
  `owner-binding-window.ts` / `owner-binding-port-aware.ts` (port-keyed window
  routing), `preview-bridge.ts` (`previewFrameContexts`,
  `isUntrustedSource` ready-frame gate), `route-preview.ts` (COEP on error
  responses); `apps/playground/src/.../realVite.ts` + bridge wiring (window
  `ports` advertisement).
