---
area: playground
status: ready
title: App() orchestration → headless core modules (xterm/monaco-free) + behavioral tests
created: 2026-07-02
epic: playground-testable-core
why: App.tsx = ~3.6K-line single component (~75 signals/effects, largest file in repo) transitively importing xterm → unrenderable in node vitest; its contract pinned by ~494 expect(source) greps that catch no behavior
user_story: As a developer changing boot/restore/switch/dev-server wiring, I want to prove the behavior in node vitest in seconds, but today the orchestration lives in one unrenderable closure and its tests grep source text.
sources: [App.test.ts tail ADAPTED-comment, ADR-0195, ADR-0003 (D-002)]
code: [apps/playground/src/App.tsx, apps/playground/src/glue/app-project-store.ts]
---
## Context
Working in-repo pattern to extend: `glue/app-project-store.ts` — extracted, behaviorally tested via `createRoot` in node vitest. Solid primitives ARE node-testable; the blocker is xterm/monaco imports, not solid. Target shape per ADR-0195: `src/orchestration/*` modules that import no UI, side effects behind module-declared injected ports (owner RPC, terminal dispatch, storage, editor host); `App.tsx` shrinks to binding.

Slices (from the 2026-07-02 App.tsx map), in dependency-spine order:
1. **dev-server lifecycle + LIVE + preview set** — devServerStatus/presetTransitioning/session-id signals, onDevServer/onPreview mirrors, wait loops (stop/idle/boot), start/stop/restart, preview-port set. Retires the "dev-server lifecycle" (~38) + "preview & port bridging" (~22) grep groups.
2. **boot/restore + project switch** — ensureWorkspaceOwnerStarted gate, restoreActiveProjectOnReload, switchTo, project-index mirror/hydrate. Retires "terminal startup & lifecycle" (~35), "project index hydration" (~12), first-run launcher (~11) groups.
3. **preset boot** — runVitePreset, onPickStarter, preset-transition queue + TS gate. Retires "preset selection & switching" (~42).
4. **remaining App.test.ts grep groups** (file I/O routing, archive, git wiring, storage mode, TS wiring, misc) — extract or convert to behavioral against already-extracted seams; anything provably un-extractable gets a recorded residual constraint in the ratchet allowlist.
Slice boundaries are REVERSIBLE naming; the spine order is load-bearing (later slices inject earlier modules as ports).

## Acceptance
- Orchestration modules live under `apps/playground/src/orchestration/`; dep-cruiser rule `no-ui-imports-in-playground-orchestration` (arch-rules.cjs) fails the build on any xterm/monaco/components/adapters import from there.
- Per slice, in the SAME PR: the slice's `expect(source)` asserts are DELETED from `App.test.ts` (and `glue/realVite.test.ts` where the slice owns them), replaced by behavioral node-vitest tests driving the extracted module through its ports; every replacement test RED-checked (revert the guarded wiring → test fails). The source-grep ratchet allowlist counts drop in the same PR.
- App.tsx keeps only binding for extracted responsibilities (creates modules, passes real ports, renders); no orchestration logic (signal wiring beyond pass-through, wait loops, session bookkeeping) remains inline for an extracted slice.
- Item closes when `App.test.ts` and `glue/realVite.test.ts` leave the ratchet allowlist (0 source-grep asserts) or every residual carries a recorded why-behavioral-is-impossible constraint in the allowlist.
- Full e2e (chromium-heavy + chromium-light) green after each slice — the wiring-refactor gate; e2e specs themselves unchanged.

## Parity cases
None — playground orchestration, no Node-API surface. Verification = RED-checked behavioral vitest per Acceptance + the existing e2e tier.

## Out of scope
- Lifting the core into a public `@riftydev/workbench*` package — stays `distribution/workbench-controllers`, own ADR, gated on a real non-Solid consumer.
- Component-file source-greps (EditorHost/PreviewPanel/FileExplorer/TerminalPanel/BottomPanel/ts-ls-monaco-providers-source/bundle-local-buffer) — burned down under the ratchet item's closing gate, no extraction needed.
- Worker-realm modules (real-vite-bootstrap, dev-server-boot, …) — ride `toolchain-build/browser-mode-unit-lane`.
- No behavior changes: any observable playground behavior change found mid-extraction is a bug to stop-and-report, not to fold in.

## Decisions
- Solid-reactive core (not framework-free), module location, port seam + test stance: ADR-0195.
- Port fakes in unit tests are the module's own contract, not a sibling-package mock (ADR-0195 §4); real-fabric coverage stays parity/conformance/e2e + browser-unit lane.
- Extraction order = dependency spine (slice 1 → 2 → 3 → 4); each slice lands whole (module + behavioral tests + grep deletion + allowlist drop) — no half-extracted slice merges.
