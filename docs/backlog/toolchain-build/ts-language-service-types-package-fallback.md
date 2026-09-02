---
area: toolchain-build
status: draft
title: TS language service never reaches `@types/*` declarations of installed packages — the React starter shows 23 false Problems
created: 2026-09-02
why: after a from-scratch `npm install` of `react` + `@types/react` the in-browser TS language service resolves `react` to `node_modules/react/index.js` and reports "Could not find a declaration file for module 'react'" plus 22 follow-on JSX errors, while local `tsc --noEmit` on the identical tree exits 0 — ADR-0166's "diagnostics match real tsc" is broken for every project whose types ship via DefinitelyTyped
user_story: As a developer opening the "Real npm project" React starter, I want the Problems panel to say what `tsc` says (zero errors), but today it shows 23 false errors because `@types/react` is never resolved
blocked_by: []
sources: [PR-300, docs/adr/toolchain-build/0166-in-browser-ts-language-service-over-vfs.md, docs/adr/toolchain-build/0177-workspace-typescript-is-required-for-ts-language-service.md, docs/backlog/playground/react-vite-starter.md]
code: [packages/ts-language-service/src/host.ts, apps/playground/src/templates/react-vite/index.ts, tests/e2e/ts-language-service.spec.ts]
---

## Context

Observed 2026-09-02 on `react-vite-starter@712deeee3` (playwright chromium,
tile `real-vite`: React 19 + `@types/react@19.2.18` installed from scratch),
after LIVE and `__riftyTsReinit()` → `true`, Problems tab 20 s later: 23 rows.

- `Could not find a declaration file for module 'react'.
  '/.rifty/workbench/v1/projects/scratch/tree/node_modules/react/index.js'
  implicitly has an 'any' type.` (App.tsx) and the same for
  `'react/jsx-runtime'` in every TSX file (×3).
- `JSX element implicitly has type 'any' because no interface
  'JSX.IntrinsicElements' exists.` ×18 (App.tsx, StatusBadge.tsx,
  IssueList.tsx).
- `Type '{ key: number; issue: Issue; }' is not assignable to type '{ issue:
  Issue; }'` (IssueList.tsx:30) — the `key` prop typing is gone without
  `@types/react`.
- Local oracle, identical 17-file seed (node v24.16.0, TypeScript 5.9.3):
  `tsc --noEmit` exit 0 (`react-vite-starter.md` `## Decisions`, local oracle).
- Mechanism: `packages/ts-language-service/src/host.ts:106` hands
  `ts.resolveModuleName` a VFS-backed `ModuleResolutionHost` (`fileExists`,
  `directoryExists`, `getDirectories`). Resolution reaches
  `node_modules/react/index.js` — the installed tree is visible — but never the
  DefinitelyTyped fallback `node_modules/@types/react`. Whether the `@types`
  lookup, the `exports`-map resolution of `@types/react/jsx-runtime`, or a
  pre-install negative entry in the shared `createModuleResolutionCache` is the
  cause is unproven: reinit and a page reload keep the 23.
- Every existing TS-LS carrier resolves types from a package's own `types`
  field (the `typescript-ls` preset seeds `node_modules/@rifty/example-types`);
  `long-tail-parity.test.ts:46` runs `jsx: 'react-jsx'` only with `types: []`
  and a hand-declared `JSX` namespace — the uncovered step is `react` /
  `react/jsx-runtime` → `node_modules/@types/react` resolution.
- Ruled out by the probe itself: a pre-install negative entry in the shared
  resolution cache — `__riftyTsReinit` rebuilds the whole LS
  (`ts-language-service.spec.ts:486`) and the cache is created per host
  (`host.ts:118`), yet the 23 survive reinit and reload. The fix lives in the
  host's resolution, not in program recreation.

Impact: every TS project that imports a package whose types ship through
DefinitelyTyped (react, express, …) shows false Problems in the playground; the "Real npm
project" hero tile opens three TSX tabs in that state. The runtime is
unaffected — Vite/esbuild strip types, the app builds, serves and Fast-Refreshes.

Dedup (2026-09-02): no backlog item or declined concept mentions `@types`,
DefinitelyTyped, `react-jsx` or `jsx-runtime` resolution.

## Question

Which step of the DefinitelyTyped fallback fails in the VFS host — the
`node_modules/@types/<name>` directory lookup, or the `exports` /
`typesVersions` resolution of `@types/react@19.2.18` (`react/jsx-runtime`)?

- RED (parity): a `ts-language-service` test over a fixture tree
  `node_modules/react/index.js` + `node_modules/@types/react/` carrying the
  REAL `@types/react@19.2.18` metadata (`package.json` with its `exports` and
  `typesVersions`, `index.d.ts`, `jsx-runtime.d.ts`) — a simplified manifest
  may be green on main and prove nothing — asserting zero diagnostics for a
  `.tsx` that imports `react` under `jsx: react-jsx`, run against real `tsc`
  on the same fixture.
- RED (e2e): the React tile's Problems count equals the local `tsc` count (0)
  after LIVE.

## Challenge

<!-- Advisory premise challenge, fresh independent critic — README §Challenge. -->

challenge: 2026-09-02 — 4 problems
- [advisory] Question keeps "stale negative entry in the shared resolution cache" + "fix in program recreation after install" as live branches, but the doc's own Context closes them: `__riftyTsReinit` is a full LS rebuild ("Rebuild the LS against the current owner VFS + tsconfig", tests/e2e/ts-language-service.spec.ts:486) and the cache is created per host (packages/ts-language-service/src/host.ts:118), so "reinit and a page reload keep the 23" already rules out a pre-install cache artifact and points the fix at the host.
- [advisory] Impact "every TS project whose dependencies ship types through DefinitelyTyped (react, express, node, …)" is sized from one carrier; `@types/node` enters via typeRoots/automatic type directives, not the import-time `ts.resolveModuleName` path (host.ts:215) the doc's mechanism describes — the `node` claim is unevidenced and inflates the share.
- [advisory] "no test covers a `@types/*` fallback or `jsx: react-jsx`" is half wrong: packages/ts-language-service/src/long-tail-parity.test.ts:46 runs `jsx: 'react-jsx'` (with `types: []` and a hand-declared `JSX` namespace); the true gap is `react/jsx-runtime` → `node_modules/@types/react` resolution, which the item should name precisely.
- [advisory] RED (parity) fixes a hand-rolled fixture shape (`@types/react/{package.json,index.d.ts,jsx-runtime.d.ts}`) while the doc admits the failing step is unproven; a simplified `package.json` (no real `exports`/`types@<=5.0` conditions of `@types/react@19.2.18`) may be green on main and never reproduce — the fixture should carry the reproduced tree's real `@types/react` metadata, else the RED proves nothing.

All four answered above (Context/Question/RED reworded 2026-09-02).

## Decisions

- Captured mid-task from PR #300's Final+GREEN verify pass (the reviewer ran
  the tile; the agent reproduced it with the probe above). Outside that unit's
  contract (no diagnostics clause) and not fixed there. REVERSIBLE — no ADR.
