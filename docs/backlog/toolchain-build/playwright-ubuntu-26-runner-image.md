---
area: toolchain-build
status: draft
title: Move browser CI jobs off the pinned ubuntu-24.04 image with a Playwright that ships an ubuntu26.04 Chromium
created: 2026-11-17
why: ubuntu-latest moved to 26.04; locked Playwright 1.60.0 has no ubuntu26.04 browser build, so browser jobs pin ubuntu-24.04 until the lock moves
user_story: As a maintainer, I want browser lanes on a supported runner image, but today they hold ubuntu-24.04 because the locked Playwright refuses ubuntu26.04
sources: [https://github.com/actions/runner-images/issues/14748, https://github.com/vanilla-wave/rifty/actions/runs/43974699316]
code: [.github/workflows/ci.yml, .github/workflows/ci-cross-browser.yml]
---

## Context

PR #395 first run on `ubuntu-latest` (2026-11-16): every e2e, browser-unit and
no-COI job failed in ~25 s at `playwright install --with-deps chromium` —
`Playwright does not support chromium on ubuntu26.04-x64` (Playwright 1.60.0).
The browser cache had expired (no CI run since 2026-10-26), so no job skipped
the install. All 483 sampled job logs 2026-10-14..26 ran `ubuntu-24.04`.

`playwright-core@1.60.0` knows ubuntu20/22/24.04 only; `1.64.1` adds
ubuntu26.04 (grep of `lib/`, 2026-11-17). Its Chromium is 156, still with the
crbug 573662744 CHECKs (`restore-service-worker-network-traces`).

The same run's `unit-and-conformance (run)` failed 8
`tools/agent-bench/src/lifecycle.fault.test.ts` cases (`Executable doesn't
exist … chrome-headless-shell`): they launch the Chromium the root
`postinstall` (`playwright install chromium firefox webkit || true`)
downloads — the CI `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` env does not stop that
CLI (green 24.04 logs show the download with the env set). Lint passed on 26.04.

Every `ci.yml` job and the cross-browser job pin `ubuntu-24.04` (one gate
image); the browser cache key carries `$ImageOS` so a binary is never restored
on another image.

## Next

Owner: toolchain maintainer. Trigger: Playwright lock bump, or GitHub's
`ubuntu-24.04` deprecation notice. Bump Playwright (Chromium jump: re-run
browser-unit, no-COI, e2e, unit and cross-browser on Linux; re-check traps
naming Chromium 148 behavior), then drop the pins; delete this draft after
green CI.

Dedup: no backlog/trap entry for runner image or Playwright host support
(2026-11-17); `github-actions-node20-runtime-deprecation` is the action
runtime, not the image.
