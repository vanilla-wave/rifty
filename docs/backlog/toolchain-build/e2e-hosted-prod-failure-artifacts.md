---
area: toolchain-build
status: draft
title: Upload failure trace for hosted and prod e2e lanes
created: 2026-09-24
why: a hosted CI failure left no trace or screenshot, so a flake recurred 2026-09-13..23 without evidence
sources: [https://github.com/vanilla-wave/rifty/actions/runs/35772823691]
code: [playwright.hosted.config.ts, playwright.prod.config.ts, .github/workflows/ci.yml]
---

## Context

`playwright.hosted.config.ts` and `playwright.prod.config.ts` use only the
`github` reporter in CI. The CI `upload-artifact` step reads `playwright-report`,
finds nothing (`No files were found with the provided path: playwright-report`),
and drops the `trace.zip`/screenshot the configs retain on failure. Light, heavy,
browser-unit and no-coi lanes emit an html report and upload it.

Seen on run 35772823691 attempt 1: the hosted webpack spec failed and the
failure left only the log line. The launcher-readiness flake was only
diagnosed by reproducing it locally.
