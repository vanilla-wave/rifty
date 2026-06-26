---
area: playground
status: shipped
title: TS language-service sandbox preset — a one-click .ts project for real LS demos
created: 2026-06-22
why: shipped — the playground now has a discoverable `typescript-ls` preset so users can try the real TS language-service surface without hand-creating a `.ts` project first
user_story: As a rifty playground visitor (or someone evaluating the M12 agent's TS capability), I can pick a "TypeScript" preset and immediately get a real .ts project where core LS paths are demonstrable in-place — squiggle + Problems, hover, go-to-def into a dep `.d.ts`, cross-file references, rename, add-import quick-fix, organize-imports, format — without knowing to `printf > foo.ts` in the terminal first
sources: [ADR-0166, ADR-0078, docs/public/compat/ts-language-service.md]
code: [apps/playground/src/templates/registry.ts, apps/playground/src/templates/project-spec.ts, apps/playground/src/components/EditorHost.tsx, tests/e2e/ts-language-service.spec.ts]
---

## Context

Landed 2026-06-22: the `typescript-ls` preset seeds a strict `.ts` Vite project,
opens a TypeScript entry, and includes cross-file symbols plus dependency `.d.ts`
fixtures. It gives users an immediate real-project surface for diagnostics,
hover/definition, refs/rename, completions, quick fixes, organize imports, and
formatting. The exhaustive hard-ceil proof lives in the TS LS parity/e2e suites,
not in seed comments.

The LS ships as real Monaco providers wherever standalone Monaco exposes the
provider shape; the remaining ✅ rows are still exposed through the
engine/protocol/client. The default Vite/JS template still seeds `main.js`, and
the out-of-program guard (correctly) returns honest-empty for a `.js` file with
`allowJs` off and no tsconfig. The shipped `typescript-ls` preset is the
discoverable "try TypeScript" path for that UX gap.

Templates are `ProjectSpec`s in `templates/registry.ts` (`vite` / `express-sqlite`
/ `socket-lab`), each with `entry` + `seedFiles`. A new TS-sandbox preset slots in
the same way.

## Verification

- `apps/playground/src/presets.test.ts` asserts the preset is selectable, wired to
  the `.ts` template, opens TS files, and seeds `tsconfig`, sibling modules, and
  dependency `.d.ts` fixtures.
- `tests/e2e/ts-language-service.spec.ts` drives the real registered providers over
  an owner-store TS project; the exhaustive feature inventory is verified in
  `packages/ts-language-service/src/long-tail-parity.test.ts`.

## Reversibility

REVERSIBLE — additive `ProjectSpec` + seed files + optional e2e; extends the
ADR-0078 template registry and ADR-0166's already-Accepted scope. No ADR (no
public API / dep / decision change). The umbrella
`toolchain-build/ts-language-service` and the compat page point here for the
"how do I try it" surface.
