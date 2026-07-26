# ADR 0174: Run vite through installed bin

Status: Accepted
Date: 2026-06

> TL;DR: `vite` is no longer an owner-registered curated command; the shell
> resolves and runs the installed `node_modules/.bin/vite` through the node-entry
> loader, while the generic `.bin` child path becomes server-capable so real CLI
> dev/preview ports still register in the playground.

> Completion 2026-07-13: curated build/preview helpers, the direct Vite
> `createServer` tail, and bespoke file-change IPC are deleted. Installed
> `.bin/vite` is the only Vite execution path; node-server keeps its dedicated
> child lifecycle.

## Context

ADR-0148 made `vite` a co-resident owner command for HMR/preview control.
ADR-0173 extended that curated command to Vite 7 build/preview via Vite's Node
API. That kept core subcommands real enough for the milestone, but it bypassed
the installed CLI: real Vite arg parsing, help/version, mode handling, and
`vite.config.*` loading did not run. Interim guards closed silent gaps by
loud-rejecting unsupported args/config, but the project mission is maximal Node
fidelity, not a permanent curated shim.

The shell already resolves bare commands through walk-up `node_modules/.bin`
when no builtin/registered command shadows them (ADR-0137). The missing pieces
were lifecycle and playground wiring: Vite dev/preview are long-running servers,
so a `.bin` child must be able to stay alive, post listened ports to the owner,
and serve cross-realm preview routes. The existing `node <file>` child already
has that lifecycle (ADR-0155).

## Decision

- Remove the owner `registerCommand('vite')` dispatch. `vite`, `vite build`,
  `vite preview`, flags, help/version, and unknown subcommands resolve to the
  installed shim via the shell's normal `.bin` path.
- Make the generic `.bin` child path server-capable by reusing the
  `node <file>` lifecycle: spawn node-entry with `serve:true` +
  `RIFTY_NODE_SERVE=1`, run the shim target with `bin:true`, await drain for
  run-to-completion CLIs, and keep serving when the program listens.
- Keep playground UX as observation, not dispatch: when the real `vite` binary
  posts a listened dev port, the owner emits the same `pty:dev-server` frames the
  page already consumes; real `vite preview` registers the production preview
  slot. Other server-capable bins register as node preview ports.
- Runtime preparation that replaces native-only browser ceilings (Rollup,
  lightningcss, esbuild bridge) is allowed before launching the real CLI. It is
  environment plumbing, not command semantics; the installed Vite entry still
  performs arg/config/subcommand behavior.

## Consequences

- `which vite` reports `node_modules/.bin/vite`, and `vite` executes the
  installed CLI instead of a hand-curated owner callback.
- `vite.config.*` is no longer pre-rejected by rifty's curated path; the real
  Vite CLI owns config loading. Unsupported config behavior must fail through
  real Vite/runtime errors, not silent ignore.
- Server-capable `.bin` execution becomes broader than Vite. This is an
  intentional fidelity improvement: CLIs that call `listen()` can now surface a
  preview port instead of being forced into run-to-completion semantics.
- The old curated build/preview helpers remain only for dead-code removal or
  future cleanup; they must not be registered as the `vite` command again.
- Vite 8/Rolldown/browser ceilings remain honest failures unless the real CLI
  path plus WASI/worker-thread support can run them end-to-end.

> **Correction 2026-07-26 (ADR-0327):** the dedicated Node-server lifecycle is
> selected only by canonical direct-entry script bytes. Installed nodemon uses
> the generic server-capable `.bin` path and remains the sole watcher/restart
> owner. Vite's installed-bin ownership is unchanged.
