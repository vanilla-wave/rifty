# Backlog — distribution (consumption-side)

How rifty is **consumed**, separate from the runtime milestones in docs/ROADMAP.md. This area = umbrella SDK, headless UI controllers, framework bindings + component kit, IDE starter template. This is a **pull backlog** (no dates, only `depends-on` edges); several items are required for the full Consumer Ready story, but are deliberately outside the current branch cutline.

Source: the distribution-and-IDE epics A-E. Publishing (EPIC A) landed under ADR-0070/0071; A4/A5/A6/A7/A8 follow-ons live under playground / toolchain-build / process-meta, NOT here.

## Directional decisions (promote to ADR when each track starts)

- **DD-1 — No inlining of `@riftydev/*` into each other.** io (builtin registry), kernel (globalProcessManager), vfs (syncMirror) hold shared module singletons read/written across packages; bundling duplicates state + silently breaks composition. Stay `external` + lockstep-pinned (ADR-0070 D4). **Ratified via ADR-0071.**
- **DD-2 — Umbrella is `@riftydev/sdk`** (not `@riftydev/runtime`, not unscoped `rifty` — npm 403'd that name). Ships scoped in the `@riftydev` scope. **Ratified: ADR-0071** (EPIC B landed).
- **DD-3 — `@riftydev/workbench` (headless UI controllers) is justified now** — non-Solid consumers foreseen; makes the playground a thin shell and sharpens the D-002 boundary (solid-js stays in the binding layer only). Accepted, not built.
- **DD-4 — Component atoms are headless + themeable** (Radix/Headless-UI style: minimal markup + CSS-vars/slots, optional default theme), NOT batteries-styled. Accepted, not built.

## Items

| file | status | epic | gist |
|---|---|---|---|
| `public-api-ai-agent-contract-snapshot-restore.md` | parked | SDK API | residual disk-state snapshot/restore/fork API after ADR-0131 FS slice |
| `public-api-ai-agent-exec-preview.md` | parked | SDK API | residual streamed exec + preview URL API after ADR-0131 FS slice |
| `workbench-controllers.md` | parked | C | lift framework-agnostic `glue/*` → `@riftydev/workbench`; playground becomes a thin binding (DD-3) |
| `framework-bindings-kit.md` | parked | D | per-framework atoms + `<RiftyIDE/>` + react/vue bindings over the workbench (DD-4) |
| `create-rifty-template.md` | parked | E | un-packageable host config (COOP/COEP, module-worker, sw.js build, WASM copy, Monaco) as a scaffold |
| `readme-open-auditable-rewrite.md` | ready | open-auditable-launch | root README reframed to the open/auditable wedge (GIF + MIT + compat + vs-WC) |
| `publish-git-and-ts-language-service.md` | ready | open-auditable-launch | publish @riftydev/git + @riftydev/ts-language-service to npm |
| `landing-compare-page.md` | ready | webcontainers-alternative-search-slot | rifty.dev/compare — verifiable WebContainers-alternative table + link-checker |
| `ai-sandbox-reference-demo.md` | draft | open-bolt-ai-sandbox-demo | open client-side AI sandbox (eval+install slice; live preview gated on exec-preview) |
| `landing-blog-surface.md` | ready | wasi-in-browser-showcase | rifty.dev/blog route + first WASI post |

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

## Promotion / GTM epics

Developer-adoption epics live in `docs/backlog/epics/` (cross-area, user-value umbrellas), sourced from `docs/research/open-webcontainers-alternative-2026-06.md`:

- `epics/open-auditable-launch` — the one-shot discovery Show HN led by the open/auditable wedge.
- `epics/webcontainers-alternative-search-slot` — the verifiable `rifty.dev/compare` page + awesome-list backlinks.
- `epics/open-bolt-ai-sandbox-demo` — an open, client-side AI-sandbox reference (bolt.diy #2008).
- `epics/wasi-in-browser-showcase` — surface the real-WASI-guest-over-shared-VFS capability.

These pull the consumption EPICs above (create-rifty-template, workbench-controllers, exec/preview, snapshot/fork) as their downstream conversion path, but do not block on them.
