# ADR 0477: Pinned browser floor proof runners

Status: Accepted
Date: 2026-09-28

## Context

ADR-0469 I7 requires floor builds, not today's bundled browsers. The upstream
`browsers.json` files were read on 2026-09-28:
- [1.28.1](https://github.com/microsoft/playwright/blob/v1.28.1/packages/playwright-core/browsers.json): Chromium 108.0.5359.29, revision 1033.
- [1.34.3](https://github.com/microsoft/playwright/blob/v1.34.3/packages/playwright-core/browsers.json): Firefox stable 113, beta 114.0b3, revision 1410.
- [1.55.1](https://github.com/microsoft/playwright/blob/v1.55.1/packages/playwright-core/browsers.json): WebKit 26.0, revision 2203, OS-specific overrides.

## Decision

`tools/floor-lane/run.mjs` installs isolated, pinned Playwright versions on demand;
no workspace dependency or lockfile change. Browser installation runs under pinned
Node18.20.8: on macOS26.6, Node24 installers produced truncated binaries (Chromium208KB
versus277KB) or hung extracting WebKit; the same Chromium installer under Node18
completed with the full executable. Host/server and smoke controller remain Node24. Each automatic install owns its browser
cache (new Playwright GC otherwise removes old-runner binaries; observed locally).
Use each runner's native protocol with its browser. Firefox uses the named beta
executable through the pinned 1.34.3 registry adapter. Reports explicitly say beta:
this is evidence for that build, never stable Firefox certification. An actual
build mismatch or unavailable launch is `unknown`, not a product failure.

One headerless page executes the existing SDK's support probe, boot, real Vite npm
install/build, durable flush, reload, exact saved-source/output comparison, reopen
and rebuild. Same page is the real-device manual protocol (I8). URL and executable
path are caller inputs. Runs are manually dispatched and record-only.

## Alternatives

- Current runner plus old executable: smaller installation, incompatible Firefox
  protocol and no pinned evidence; rejected. Explicit executable-path remains for
  a caller's Chromium-compatible browser, identified by its observed build.
- One current Playwright suite: simpler, but only characterizes current builds;
  violates I7. Reusing its assertions cannot establish a version floor.
- Separate fixture per engine/device: duplicates the composed proof; rejected.

## Consequences

Pinned tooling is temporary, not a shipped dependency. Artifacts retain browser
version, runner, source revision, per-step results and harness limitations. Real
Safari/iOS/Yandex still require the user's hardware result; no WebKit substitution.
