---
area: playground
status: draft
title: Dev Mode path is dead/unreachable and unrecorded; ADR-0095 still Accepted, ADR-0073 REPL claims stranded
created: 2026-06-13
why: Commit f03ac50a ('replace repl with visible terminals', shipped with no ADR) made Dev Mode unreachable and left startDevMode dead, but ADR-0095 (whose deliverable was live dev-mode preview via startDevMode) remains Accepted with no superseded pointer and ADR-0073's REPL-preset claims are stranded — overturning a recorded decision requires a superseding ADR.
user_story: As a rifty contributor reading the decision record, I want it to match the shipped playground, but today the `Dev · port 3000` mode and `startDevMode` are dead/unreachable while the records still describe live dev-mode preview and auto-running REPL presets that no longer exist.
sources: [ADR-0095, ADR-0073, ADR-0126, commit f03ac50a]
code: [apps/playground/src/glue/devMode.ts, apps/playground/src/App.ts, apps/playground/src/presets.ts, apps/playground/src/adapters/useMode.ts, tests/e2e/m10-dev-hmr.spec.ts, docs/adr/README.md]
---

## Context

glue/devMode.ts startDevMode (line 59) has ZERO non-test importers repo-wide. All 4 presets are mode:'real-vite'; useMode.ts inits mode to 'real-vite' and loadPreset never receives 'dev' -> App.tsx:893 machine.mode()==='dev' and the 'Dev · port 3000' label are unreachable. m10-dev-hmr.spec.ts is already test.skip with a retirement note. ADR-0095 Status: Accepted, README.md:103 lists it with no superseded pointer; its acceptance bullets ('verified live', startDevMode().close() teardown) are dead. ADR-0073 claims 'four REPL presets auto-run' — no REPL exists. NOTE: hmr-bridge.ts is NOT dead: Real-Vite uses its tokenized URL/plugin helpers and generic browser bridge injection, while setupHmrBridge remains the mini-dev broadcaster. The gap is the dead devMode.ts + unreachable mode + unrecorded ADR retirement only. Closest existing items (rfv-to-rt-rename, node-server-restart, bridge-caller-audit) are unrelated.

## Options or Next

Option A (lean): delete glue/devMode.ts, drop 'dev' from PresetMode/Mode/AiCommandSuggestionMode unions and the App.tsx:893 branch + dead useMode.ts plumbing; remove the skipped m10-dev-hmr.spec.ts; record a superseding/annotating ADR retiring ADR-0095's dev-mode-preview subject and noting ADR-0073's REPL claims historical (README pointer). Option B: re-wire a dev preset back to startDevMode (contradicts the visible-terminals direction of f03ac50/ADR-0126; not recommended). Either way add a failing-first test pinning the chosen contract (e.g. assert no 'dev' PresetMode).

## Reversibility

Deletion of dead code is REVERSIBLE, but the ADR retirement record (overturn recorded decision -> superseding ADR) leans IRREVERSIBLE — a superseding/annotating ADR is the clean close.
