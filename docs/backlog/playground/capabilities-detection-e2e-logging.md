---
area: playground
status: draft
title: Wire capabilities-detection (single source of truth) into startup + e2e logging
created: 2026-06-08
why: D-006 specifies a data-driven capabilities source for the browser-compat report; ambiguous whether detectCapabilities is wired into startup + e2e logging
user_story: As a developer checking whether my browser can run the playground, I want startup to log my real `crossOriginIsolated`/`SharedArrayBuffer`/`FileSystemSyncAccessHandle`/`Atomics.waitAsync` support, but today it is unverified whether `detectCapabilities` is wired into boot logging + the e2e harness, so each run may record nothing.
sources: [D-006, ADR-0007, audit-digest missedLive]
---
## Context
A capabilities-detection module (`packages/runtime-js/src/env/capabilities.ts`) should be the single source of truth, logging `crossOriginIsolated`, `SharedArrayBuffer`, `FileSystemSyncAccessHandle`, `Atomics.waitAsync` at startup and into e2e. D-006 / ADR-0007 specify this as the data-driven feed for the `docs/public/compat/browsers.md` browser-compat report (feature-detection over UA). Audit flagged it ambiguous-verify: confirm it is implemented and wired into e2e, otherwise it is open work.
## Options / Next
Next: (1) verify `detectCapabilities` exists and is the single source; (2) wire it into playground boot logging + the Playwright e2e harness so each run records the capability set; (3) feed the same data into the eventual `docs/public/compat/browsers.md` generated report (see toolchain-build/browser-compat-matrix). If already wired, close this; the verification itself is the deliverable.
## Reversibility
Reversible — wiring + logging, feature-detection only (D-006 forbids `if(isFirefox)` product code). No cross-package API change if `detectCapabilities` already exists.
