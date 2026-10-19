---
area: npm-client
status: draft
title: A from-scratch React + Vite 7 install now resolves `vite@7.3.7` and the esbuild runtime refuses it (`supports exact Vite 7.3.6; executed 7.3.7`)
created: 2026-10-16
why: the heavy e2e `react-vite-build.spec.ts` fails with no rifty change because `^7` ranges resolve the newly published 7.3.7, which the exact-7.3.6 esbuild runtime policy refuses loudly
user_story: As a developer creating the "Real npm project" React starter, I want `npm run dev`/`build` to work, but today the fresh install takes vite 7.3.7 and Vite refuses to start with `vite esbuild runtime supports exact Vite 7.3.6; executed 7.3.7`
sources: [tests/e2e/react-vite-build.spec.ts, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md]
code: [tools/shadow-registry/src/runtime/vite-esbuild-runtime.ts]
---

## Context

Finding (2026-10-16, branch `t3/honest-adaptations-location` while running the
Vite lanes of the closed Vite CLI hook unit (ADR-0530; verdict `docs/backlog/npm-client/reference/vite-cli-action-keepalive-hook-removal-final-green.json`); the failure is
in the version gate, not the removed hook): `RIFTY_PLAYGROUND_PORT=5314 npx playwright test
--project=chromium-heavy tests/e2e/react-vite-build.spec.ts` → terminal
`Error: vite esbuild runtime supports exact Vite 7.3.6; executed 7.3.7`, preview
never ready (180 s). Starters pin exact `vite: 7.3.6` (`fdea02023`, PR #341;
`apps/playground/src/templates/vite-version.contract.test.ts`): a starter pin `AGENTS.md`
§Fidelity forbids, recorded as `platform-gap` in the adaptation inventory; this item's fix
restores `^7` and retires that pin. The proven-version admission policy for Vite 7.3.7 was named a
separate refine in the guest-package-patches handoff (§Фон); this records the
user-visible failure it now causes.

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->
