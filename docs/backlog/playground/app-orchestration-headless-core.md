---
area: playground
status: draft
title: App() orchestration → headless core modules (xterm/monaco-free) + behavioral tests
created: 2026-07-02
epic: playground-testable-core
why: App.tsx = ~3.4K-line single component (~75 signals/effects, largest file in repo) transitively importing xterm → unrenderable in node vitest; its contract pinned by 392 expect(source) greps that catch no behavior
user_story: As a developer changing boot/restore/switch/dev-server wiring, I want to prove the behavior in node vitest in seconds, but today the orchestration lives in one unrenderable closure and its tests grep source text.
sources: [App.test.ts tail ADAPTED-comment, ADR-0003 (D-002)]
code: [apps/playground/src/App.tsx, apps/playground/src/glue/app-project-store.ts]
---
## Context
Working in-repo pattern to extend: `glue/app-project-store.ts` — extracted, behaviorally tested via `createRoot` in node vitest. Solid primitives ARE node-testable; the blocker is xterm/monaco imports, not solid. Target shape: orchestration modules that import neither xterm nor monaco, side effects behind injected ports (owner RPC, pty, storage, editor host); `App.tsx` shrinks to binding.
## Options / Next
- Slice by responsibility, not big-bang: boot/restore sequencing, project switch, dev-server lifecycle/LIVE pill, preview set, editor tabs — each extractable separately; the slice's source-greps replaced by behavioral tests in the SAME PR, each RED-checked (revert → fails).
- Fork to resolve at refine: solid-reactive core (node-testable, playground-internal, cheap now) vs framework-free observable core (directly liftable to `@riftydev/workbench` under D-002). Decides the later package-lift cost.
- Guard against regression: no xterm/monaco imports in extracted modules (dep-cruiser rule or ratchet-check extension).
