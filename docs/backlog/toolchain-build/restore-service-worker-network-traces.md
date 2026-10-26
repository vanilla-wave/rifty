---
area: toolchain-build
status: draft
title: Restore browser-unit Service Worker network traces after Chromium fixes stopped-target inspection
created: 2026-10-26
why: Chromium aborts on trace-body inspection after a Service Worker stops; browser-unit omits SW network telemetry until the upstream fix ships
sources: [https://github.com/chromium/chromium/commit/62c64507867e537d7024ae565d0f893ee5a64843, https://github.com/vanilla-wave/rifty/actions/runs/40233130360]
code: [playwright.browser-unit.config.ts, tests/browser-unit/service-worker-trace.spec.ts]
---

## Context

Linux Chromium 148: a native HTTP 403 stops the SW before Playwright's trace
recorder sends `Network.getResponseBody`. `NetworkHandler::GetResponseBody`
CHECKs the cleared `storage_partition_`; browser exits SIGTRAP. No rifty code
needed: the real-HTTP regression reproduces it with fresh browser contexts.
Native gdb stack and RED/GREEN evidence live on the repair PR.

Upstream `62c64507867e` removes the invalid CHECKs. Checked 2026-10-26:
Playwright 1.64.1's Chromium 156.0.8078.4 still contains them; upgrading to that
stable release does not remove the cause.

Browser-unit sets Playwright's `PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK`:
SW requests/responses are absent from traces and context network events.
Native SW registration, activation, fetch handling and all assertions remain
active. Page network, DOM snapshots, screenshots and action traces remain.
No other lane changes. This is a test-observer limitation, not a runtime gap.

## Next

Owner: toolchain maintainer. Trigger: the locked Playwright Chromium includes
upstream `62c64507867e` (or its backport). Remove the config flag/TODO, run
`service-worker-trace.spec.ts` plus `sandbox-support.spec.ts` on Linux with
normal tracing; delete this draft after green CI. Until then the runtime
support verdict must continue to observe native SW failures.

Dedup: no existing item for crbug 573662744 / stopped-SW response-body tracing
in backlog, traps or declined ADR concepts (2026-10-26).
