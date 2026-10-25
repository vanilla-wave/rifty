---
area: npm-client
status: draft
title: Retire the exact Vite 7 starter pin after the COI upstream-twin cutover
created: 2026-10-16
why: COI now runs installed Vite through stock esbuild, but starters still seed exact 7.3.6 rather than the intended ^7 range
user_story: As a developer creating the React starter, I want its Vite dependency to follow ^7, but the template still pins 7.3.6
sources: [tests/e2e/react-vite-build.spec.ts, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md]
code: [apps/playground/src/vite-project-policy.ts, apps/playground/src/templates/vite-version.contract.test.ts]
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

2026-10-20: ADR-0543 removes the COI refusal. The original failure above is
history; no-COI retains its legacy policy. Retiring the starter pin and proving
`^7` lanes remains this item's owner/trigger; the upstream-twin goal does not
claim that retirement.

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->
