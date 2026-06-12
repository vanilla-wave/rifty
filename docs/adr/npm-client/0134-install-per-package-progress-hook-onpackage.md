# ADR 0134: install() per-package progress hook (onPackage)

Status: Accepted
Date: 2026-06

> TL;DR: `InstallOptions.onPackage?(event)` — optional callback fired once per unique (name, version) when its tarball resolves; carries `cacheHit`. Lets the playground terminal stream what `npm install` is installing.

## Context

Sandbox-kinds work (ADR-0135): from-scratch presets visibly run `npm install`; user must see *which packages* land. `install()` today reports nothing until it returns `result.packages` — the npm shell command can only print a post-hoc summary. npm-shell-command.ts header already flagged the gap: "a streaming hook lands when the installer grows one."

Options:
1. Print `result.packages` after completion — no API change, but all lines burst at the end; not live.
2. **onPackage hook on InstallOptions** — fires as each (name, version) fetch+verify settles (`fetchAndUnpackToCache` resolution, dedup'd via `inFlight`) — chosen.
3. Full event-stream API (resolve/fetch/link phases) — overkill for the need; can supersede later.

## Decision

- `InstallOptions.onPackage?: (event: InstallProgressEvent) => void`; `InstallProgressEvent = { name, version, cacheHit }`.
- Fire point: success resolution of the dedup'd fetch task in `walkAndPin` — once per unique (name, version) per install; both lockfile fast path and live path fire; failed fetches (incl. skipped optionals) do not fire.
- Callback throw is caught + `console.warn` — a progress sink must not abort an install.
- Hook fires when bytes are verified, not when files are linked (link is one batch at the end; per-file granularity is not the contract).

## Consequences

- Public API between packages grows one optional field — additive, no caller breaks.
- Playground prints `npm: + <name>@<version>` live (ADR-0135 visible-install UX).
- Event order is fetch-completion order, not dependency order — documented, not contractual.
- Follow-up: phase-level progress (resolve/link) only if a real consumer appears.
