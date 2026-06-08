# Backlog — distribution (consumption-side)

How rifty is **consumed**, separate from the runtime milestones (docs/ROADMAP.md tracks M0-M12). This area = umbrella SDK, headless UI controllers, framework bindings + component kit, IDE starter template. Mostly optional / exploratory — a **pull backlog** (no dates, only `depends-on` edges; pull an item when it's worth doing).

Source: the distribution-and-IDE epics A-E. Publishing (EPIC A) landed under ADR-0070/0071; A4/A5/A6/A7/A8 follow-ons live under playground / toolchain-build / process-meta, NOT here.

## Directional decisions (promote to ADR when each track starts)

- **DD-1 — No inlining of `@riftydev/*` into each other.** io (builtin registry), kernel (globalProcessManager), vfs (syncMirror) hold shared module singletons read/written across packages; bundling duplicates state + silently breaks composition. Stay `external` + lockstep-pinned (ADR-0070 D4). **Ratified via ADR-0071.**
- **DD-2 — Umbrella is `@riftydev/sdk`** (not `@riftydev/runtime`, not unscoped `rifty` — npm 403'd that name). Ships scoped in the `@riftydev` scope. **Ratified: ADR-0071** (EPIC B landed).
- **DD-3 — `@riftydev/workbench` (headless UI controllers) is justified now** — non-Solid consumers foreseen; makes the playground a thin shell and sharpens the D-002 boundary (solid-js stays in the binding layer only). Accepted, not built.
- **DD-4 — Component atoms are headless + themeable** (Radix/Headless-UI style: minimal markup + CSS-vars/slots, optional default theme), NOT batteries-styled. Accepted, not built.

## Items

| file | status | epic | gist |
|---|---|---|---|
| `sdk-umbrella-facade-limits.md` | active | B | EPIC B follow-ons; honest limit — createSandbox can't hide bundler bits (worker URLs / sw.js build / WASM serving) |
| `workbench-controllers.md` | parked | C | lift framework-agnostic `glue/*` → `@riftydev/workbench`; playground becomes a thin binding (DD-3) |
| `framework-bindings-kit.md` | parked | D | per-framework atoms + `<RiftyIDE/>` + react/vue bindings over the workbench (DD-4) |
| `create-rifty-template.md` | parked | E | un-packageable host config (COOP/COEP, module-worker, sw.js build, WASM copy, Monaco) as a scaffold |

## Dependency map

```
A (publish, landed) ── B (umbrella/SDK, landed) ── C (workbench) ── D (bindings + atoms) ── E3 (hosted shell)
                              └──────────────────────────────────── E1/E2 (template host config)
```

## Ready-IDE spectrum

- **Embeddable runtime SDK** (bring your own UI): B (+A). ~closest, shipped.
- **Drop-in `<RiftyIDE/>` per framework**: +C +D.
- **Hosted IDE from a template**: +E.

EPIC A landed; the A4-A8 publishing follow-ons are filed under their owning areas (playground/toolchain-build/process-meta), not here.
