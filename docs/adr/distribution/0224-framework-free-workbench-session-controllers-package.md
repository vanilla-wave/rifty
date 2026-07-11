# ADR 0224: Framework-free workbench session controllers package

Status: Accepted
Date: 2026-07

> TL;DR: publish `@riftydev/workbench` as the browser-only, framework-free
> session-controller module above rifty runtime packages and below UI bindings;
> hosts inject every asset URL plus the registry endpoint, and one page may boot
> only one workbench session at a time.

## Context

The embeddable-dev-loop scenario needs the playground's real boot, terminal,
install, preview, editor-sync, and file-tree behavior without importing
`apps/playground` or adopting Solid. Those controllers already exist as
framework-independent glue and UI-free orchestration, but their app-local seam
permits sibling drift and is not publishable.

ADR-0003 confines Solid to the playground. ADR-0197 deliberately kept the first
orchestration extraction Solid-reactive, with an accepted signals-to-observables
cost when a non-Solid consumer pulled a workbench package. That consumer now
exists. A new package and its public interface are irreversible.

## Decision

- Add `packages/workbench`, published in the lockstep 0.x set as
  `@riftydev/workbench`. Its architecture tier is above runtime, shell,
  terminal, npm-client, and SDK-level primitives, and below playground or later
  framework bindings. It imports no app code, foreign `src/internal/*`, Solid,
  Monaco, xterm UI, Vite plugin, or `import.meta.env` surface.
- The package owns one deep session-controller interface: project boot/teardown,
  PTY and shell commands, install/dev-server lifecycle, proven preview state,
  editor-to-VFS synchronization, and watched file-tree mutations. State crosses
  the seam through snapshots plus subscribe callbacks; lifecycles are explicit
  `dispose()` methods. No reactive-framework primitive is public.
- The playground imports every lifted glue/orchestration module from this
  package. Its richer multi-project/SCM/TS-LS bindings stay app-owned over that
  core; the top-level embedder session/controllers are exercised through a
  Vite-hosted browser harness. No lifted app-local copy remains.
- Browser construction fails loudly when DOM or Worker capabilities are absent.
  Boot enforces one active session per page because kernel and service-worker
  ownership are singletons. Dispose releases the claim after workers, PTY, and
  preview routes are torn down.
- Host configuration supplies all emitted worker, service-worker, and WASM URLs
  plus the npm registry endpoint. The registry endpoint is required and
  validated at session construction; there is no default external URL.
- Protocol-specific host services stay outside the package. The generic owner
  handle can send/observe structured-clone-safe extension frames only after
  owner readiness, and the owner-worker entry exposes the active-project
  dependency barrier; refused/dead channels reject. The playground builds its
  optional TS-LS child relay entirely at that app-owned seam.
- Preview becomes LIVE only after the existing service-worker round-trip proof.
  Storage fallback and mid-session failures remain observable controller state
  or loud error events; they are never inferred as success.
- Vite is the first verified host. The module remains plain ESM and
  bundler-agnostic; other bundlers are documented as unverified, not claimed.
- Add no external dependency. The module composes existing `@riftydev/*`
  implementations and their bounded network/storage/concurrency behavior.

## Consequences

- SaaS hosts can drive the complete development loop with their own UI while
  running the same package-owned owner, PTY, preview, VFS, and orchestration
  implementation the playground dogfoods.
- Solid bindings become thin adapters over a framework-free seam; locality
  eliminates playground/workbench behavior drift.
- Hosts must emit and pass asset URLs, serve a correctly scoped service worker,
  configure a registry endpoint, provide COOP/COEP, and render capability/error
  states themselves.
- Multiple workbench sandboxes in one page and SSR/Node controller use are
  explicitly unsupported and throw instead of degrading silently.
