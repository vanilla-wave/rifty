# ADR 0026: `process.platform` / `process.arch` report honest values

Status: Accepted (promoted from Q-2026-05-23-003)
Date: 2026-05

## Context

`riftyProcess` (`packages/runtime-js/src/builtins/process.ts:74-75`) reports `platform = 'rifty'` and `arch = 'wasm'`. Real packages that branch on these (Rollup's `dist/native.js`, `fsevents`, `esbuild`) bail with "platform not supported" errors. There are two stable positions:

- Be honest about the host so failures are loud and clearly attributable to this runtime.
- Lie (`'linux'` / `'x64'`) so packages take their JS fallback paths, accepting that any code that *acts* on `platform` (path separators, signal handling, binary downloads) will silently do the wrong thing.

This decision is borderline per the IRREVERSIBLE checklist: `process.platform` / `process.arch` are part of the de-facto Node ABI exposed to guest code; changing them later is a breaking change for anything reading them. The acceptance below is therefore explicit.

## Options considered

- **A — Keep `'rifty'` / `'wasm'`, shim individual native packages (chosen).** Every failure points to a real gap; no surprises from packages assuming a real OS. Cost: per-package shim work (done: esbuild, rollup-native; pending: terser, swc, sass, fsevents as they come up).
- **B — Report `'linux'` / `'x64'`.** Most JS-only packages just work. Cost: native modules silently try to `dlopen` and explode with cryptic errors instead of a clean "not supported on rifty"; path manipulators may emit `/`-vs-`\` mismatches if Windows assumptions hide elsewhere.
- **C — Configurable per boot (`createServer({ platform: 'linux' })`).** Flexibility; default honest, opt-in lie. Cost: a knob to document and test; not justified at today's scale.

## Decision

`process.platform === 'rifty'` and `process.arch === 'wasm'`. We accept the per-package shim cost.

If the list of native-binding packages requiring shims grows past ~10, revisit and consider Option C with `'linux'` as the default-lie config. Until then, Option A stands.

## Consequences

- Public ABI commitment: `process.platform === 'rifty'`, `process.arch === 'wasm'`. Any future change requires a superseding ADR and is treated as a breaking change for guest code.
- Each new toolchain integration brings a per-package shim cost when the package gates on `platform` / `arch`. Concrete examples in repo today: `apps/playground/src/adapters/esbuild-shim.ts`, the Rollup `dist/native.js` overlay.
- Failures from this choice surface as recognisable "platform not supported on rifty" errors instead of silent miscompiles — the trade-off this ADR explicitly buys.
- Capability detection in user code can now distinguish "running on rifty" from "running on Node" by reading these fields directly; that becomes a supported pattern.

## Acceptance criteria

- [ ] No `TODO(ADR): Q-2026-05-23-003` markers remain in the repo.
- [ ] `process.platform` and `process.arch` continue to return `'rifty'` and `'wasm'` after the promotion (no behaviour change — this ADR ratifies the existing implementation).
- [ ] OPEN_QUESTIONS.md moves Q-2026-05-23-003 to the "Promoted" section with this ADR as the resolution.
