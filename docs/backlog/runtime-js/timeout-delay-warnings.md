---
area: runtime-js
status: draft
title: Timers clamp an out-of-range delay without Node's Timeout*Warning
created: 2026-11-18
why: Node prints `TimeoutOverflowWarning` / `TimeoutNegativeWarning` / `TimeoutNaNWarning` to stderr when it sets a delay to 1 ms; rifty clamps silently.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/timers.ts, packages/isolate-guest/src/guest/web-shim.ts]
---

## Context

`node -e "setTimeout(() => console.log('t'), 2**31)"` (v24.16.0, `env -i`) →
stderr `(node:PID) TimeoutOverflowWarning: 2147483648 does not fit into a 32-bit signed integer.\nTimeout duration was set to 1.\n(Use \`node --trace-warnings ...\` …)`,
stdout `t`, exit 0; `-5` → `TimeoutNegativeWarning: -5 is a negative number.`;
`NaN` → `TimeoutNaNWarning: NaN is not a number.` The isolate host @ 264e4b894
(next commit) clamps the same way with empty stderr (corpus ceiling row
`timer-delay-out-of-range`). The warning belongs to the runtime's timers
(`process.emitWarning`), shared with the browser.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
