---
area: toolchain-build
status: ready
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

Recurrence 2026-09-28: run36441519067 / job108994290327 (PR362) reported
trace/screenshot under test-results but attempted only the absent playwright-report
upload. The post-reload selector timeout is separately captured in
`docs/backlog/playground/hosted-webpack-reload-ci-timeout.md`; no shared runtime
cause is inferred from the older launcher failure.

## Challenge

challenge: 2026-09-28 — clear; observed toolchain defect, existing retention configuration and failed CI upload are the authority (RDY-8).

## Reference contract

Existing hosted/prod Playwright configs retain trace and screenshot under test-results; GitHub upload-artifact accepts a multiline path list. CI run36441519067 confirmed the mismatch.

## Acceptance

1. The e2e matrix failure upload includes test-results, preserving existing HTML reports and original test verdicts. → scenario

## Decisions

- 2026-09-28 — required diagnostic repair for PR362 hosted reload timeout; same upload owner covers hosted/prod, no runtime or oracle changes.

## User scenario

A maintainer opens a failed hosted/prod CI run and retrieves the Playwright trace/screenshot retained by the existing config; today the upload misses their directory.

## Out of scope

Changing test results, timeouts, retries or runtime restoration behavior.
