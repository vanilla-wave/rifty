---
area: playground
status: ready
title: Prove Vite fallback-port preview after strictPort retirement
created: 2026-07-08
why: PR #112 removes generated `--strictPort` from the shell/.bin Vite dev path, but no browser e2e proves that Vite's fallback port becomes the LIVE/preview port when the preferred port is busy
user_story: As a developer running Vite in rifty, I want Vite's own fallback-port behavior to work like local Node, but today the PR only proves that the generated command no longer contains `--strictPort`.
blocked_by: []
sources: [docs/adr/net/0189-preview-loopback-websocket-bridge.md]
code: [apps/playground/src/templates/project-spec.ts, tests/e2e/manual-vite-install.spec.ts]
---

## Context

PR #112 makes the visible Vite boot command `vite --port <template-port>` and the `.bin/vite`
wrapper no longer injects `server.strictPort`. That is the right direction, but the
proof is incomplete: a unit test sees the command string, while no browser e2e occupies
the preferred port and then checks that Vite's actual fallback port is the port rifty
publishes to LIVE/preview.

## User scenario

A developer runs `vite --port <preferred>` through rifty while `<preferred>` is
already occupied. Vite chooses a fallback port exactly as it does under real Node,
and rifty publishes that actual port to the LIVE pill and preview route.

## Acceptance

- Browser e2e RED first: start a real listener on the template's preferred Vite port, then run `vite --port <preferred>` through the normal shell/.bin path.
- The test asserts Vite selects a different port, the LIVE pill/preview entry use that actual port, and `/preview/<actual-port>/` serves the Vite page.
- The stale preferred port must not satisfy the assertion; the test fails if preview still points at `<preferred>`.
- The test covers the normal shell/.bin path, not the legacy curated `bootDevServer` path.

## Parity cases

- Real Node Vite with `strictPort` unset and a busy requested port picks an available fallback port and prints the selected URL.
- Rifty shell/.bin Vite observes the same selected port through the net registry and routes preview to it.

## Out of scope

- Deleting legacy direct Vite boot config; tracked in `playground/vite-curated-boot-residual-forces`.

## Decisions

- This is a proof item, not a new behavior decision: Vite's own fallback-port behavior is the desired behavior once generated `strictPort` is gone.
