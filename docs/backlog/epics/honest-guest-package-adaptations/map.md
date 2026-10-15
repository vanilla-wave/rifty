# Map — honest-guest-package-adaptations

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `runtime-js/keepalive-host-async-node-carriers` — **host-async-refs** — I1;
   observed defect with a Node baseline; ADR at pickup extends ADR-0152 §1
   (pattern ADR-0158/0446/0447); minimal pattern first (`buffer.Blob` body
   reads), then the remaining classes on the same `ref()/unref()` seam.
2. `npm-client/vite-cli-action-keepalive-hook-removal` — **cli-bytes** — I2;
   independent of 1 (probe 1: no masked window on `vite build`); proven by its
   own installed-bytes identity test + Vite lanes incl. a failing-config
   stderr/exit-1 row; a window a lane exposes routes to 1 (REV-12);
   `trackKeepalivePromise` export removal decided by ADR at pickup (DEC-1 p1).
3. `npm-client/guest-package-adaptation-inventory-classes` — **inventory** —
   I3; last, classifies the final state incl. catalog substitutions; the two
   Vite root policies take their class from the real-Node-at-`/` artifact
   (evidence §Root).

## Open questions

- Which further host-task-async carriers exist on Node's surface beyond the
  four probed (zlib streams, in-guest Response bodies, `File`, `structuredClone`
  of transferables)? — owner: agent — sweep at pickup of item 1.
- Does the `@riftydev/runtime-js` `trackKeepalivePromise` export have any
  consumer outside the Vite hook? — owner: agent — grep + packed-consumer lane
  at pickup of item 2.

## Out of scope

- Project location default / knob — `epics/project-location-independence`
  (separate draft goal, user 2026-10-15).
- Vite 7.3.7 / proven-version admission policy — separate refine (handoff §Фон).
- Browser-only async APIs (`indexedDB`, `caches`, `navigator.locks`,
  `scheduler`) — not Node surface.
- `WebAssembly.compileStreaming`/`instantiateStreaming` — loud ceiling, ADR-0158.
- Depth-2 nested-spawn drain guard — stays in `runtime-js/keepalive-residual-gaps`.
- Public compat "Adaptations" section; machine gate over the inventory — user
  decisions 2026-10-15.
