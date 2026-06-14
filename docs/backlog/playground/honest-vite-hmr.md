---
area: playground
status: parked
title: Honest module HMR for the real-vite preview (replace the naive full reload)
created: 2026-06-14
why: every edit full-reloads the preview iframe (white flash mitigated, app state lost); real Vite module-HMR over the cross-realm bridge is deferred to M12+
user_story: As a developer editing a file in the real-vite sandbox, I want changed modules hot-swapped in place with no full page reload, but today the cross-realm HMR bridge ships a hand-rolled `{type:'update'}` that the injected client turns into `location.reload()` — so every edit reloads the whole iframe, dropping app state (scroll, inputs, route) and relying on a seeded dark bg to not flash white.
sources: [ADR-0017, ADR-0095, ADR-0126, ADR-0076]
code: [apps/playground/src/glue/hmr-bridge.ts, apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/templates/project-spec.ts]
---

## Context

The preview iframe loads Vite's real client (`/@vite/client`) but it can NOT connect: its `WebSocket` can't cross the iframe↔worker realm boundary (no real TCP, SW doesn't proxy the WS upgrade) — see `net/cross-realm-websocket-bridge`. So HMR is bridged over `BroadcastChannel` (`glue/hmr-bridge.ts`), but the bridge only forwards `broadcastFileUpdate`'s hand-rolled `{type:'update', event:'change', path}` (`workers/real-vite-bootstrap.ts`), and the injected `hmrClientScript` reacts by calling `location.reload()` (`hmr-bridge.ts:85-89`). That is a full reload, not module replacement — confirmed by ADR-0126 ("automatic preview refresh = the iframe HMR client alone", reload-based). The comment marks it "Full ESM HMR is out of scope — higher-level concern (M12+)".

History: module HMR never worked in the playground — git-verified, `import.meta.hot`/`hot.accept` have never existed in the tree. The naive `location.reload()` is in the bridge client since the initial M0-M10 baseline commit, the dev-mode mini-Vite client (`examples/vite-like-dev/src/index.ts`) reloads too ("Naive HMR: reload"), and the `m10-hmr` e2e asserts a reload, not a module patch. "HMR" here has always meant "preview auto-reloads on edit", never state-preserving hot replacement. This is net-new, not a regression.

Consequence (what prompted this): every keystroke-debounced edit reloads the iframe, dropping app state and (before the mitigation) flashing white. Interim mitigation already shipped — `buildIndexHtml` (`templates/project-spec.ts`) seeds `<style>html,body{margin:0;background:#101218}</style>` so the reload paints dark from the first frame instead of white. That mitigation is orthogonal to HMR and stays useful even after honest HMR (Vite still full-reloads for non-HMR-able changes).

## Options or Next

Depends on `net/cross-realm-websocket-bridge` (the real cross-realm WS carrier, M12). Then:

1. Let the iframe's real `@vite/client` connect over the bridged carrier (shim `WebSocket` for the HMR URL onto `BridgedWebSocket`, or Vite custom-transport config).
2. Forward Vite's REAL `HMRPayload`s from the worker server's HMR channel over the bridge verbatim — drop the hand-rolled `{type:'update'}`.
3. Retire (or fall back to) the reload-only `hmrClientScript`; the real client patches modules via `import.meta.hot`.
4. Keep the dark-bg seed: Vite itself full-reloads for non-`accept` boundaries / `index.html` / config edits + initial load.

Extend the `m10-hmr` e2e to assert a module patch (no full reload) for an HMR-able edit, alongside the existing full-reload-on-update proof.

## Reversibility

REVERSIBLE — backlog item. The naive reload is behavior-preserving for "preview updates on edit"; honest module HMR is an enhancement gated on the net cross-realm WS bridge.
