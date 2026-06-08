# ADR 0026: `process.platform` / `process.arch` report honest values

Status: Accepted (promoted from Q-2026-05-23-003)
Date: 2026-05

## Context

`riftyProcess` (`packages/runtime-js/src/builtins/process.ts:74-75`) reports `platform = 'rifty'`, `arch = 'wasm'`. Packages that branch on these (Rollup `dist/native.js`, `fsevents`, `esbuild`) bail with "platform not supported". Two stable positions:

- Be honest about the host → failures are loud and attributable to this runtime.
- Lie (`'linux'` / `'x64'`) → packages take JS fallback paths, but any code that *acts* on `platform` (path separators, signals, binary downloads) silently misbehaves.

Borderline IRREVERSIBLE: `process.platform` / `process.arch` are part of the de-facto Node ABI exposed to guest code; changing them later breaks anything reading them. Hence the explicit acceptance below.

## Options considered

- **A — Keep `'rifty'` / `'wasm'`, shim native packages individually (chosen).** Every failure points to a real gap; no surprises from packages assuming a real OS. Cost: per-package shims (done: esbuild, rollup-native; pending: terser, swc, sass, fsevents).
- **B — Report `'linux'` / `'x64'`.** Most JS-only packages just work. Cost: native modules silently `dlopen` and explode cryptically instead of cleanly reporting "not supported on rifty"; hidden Windows assumptions could surface as `/`-vs-`\` mismatches.
- **C — Configurable per boot (`createServer({ platform: 'linux' })`).** Default honest, opt-in lie. Cost: a knob to document and test; not justified at today's scale.

## Decision

`process.platform === 'rifty'`, `process.arch === 'wasm'`. We accept the per-package shim cost.

If native-binding packages needing shims grow past ~10, revisit Option C with `'linux'` as the default-lie config. Until then, Option A stands.

## Consequences

- Public ABI commitment: `process.platform === 'rifty'`, `process.arch === 'wasm'`. Any change requires a superseding ADR and is a breaking change for guest code.
- Each toolchain integration brings a per-package shim cost when it gates on `platform` / `arch`. In-repo examples: `apps/playground/src/adapters/esbuild-shim.ts`, the Rollup `dist/native.js` overlay.
- Failures surface as recognisable "platform not supported on rifty" errors instead of silent miscompiles — the trade-off this ADR buys.
- User code can distinguish "running on rifty" from "running on Node" by reading these fields directly; a supported pattern.

## Acceptance criteria

- [ ] No `TODO(ADR): Q-2026-05-23-003` markers remain in the repo.
- [ ] `process.platform` / `process.arch` still return `'rifty'` / `'wasm'` after promotion (no behaviour change — this ADR ratifies the existing implementation).
- [ ] OPEN_QUESTIONS.md moves Q-2026-05-23-003 to the "Promoted" section with this ADR as resolution.
