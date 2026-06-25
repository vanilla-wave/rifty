---
area: playground
status: parked
title: TS language-service sandbox preset — a one-click .ts project that exercises every shipped LS feature
created: 2026-06-22
why: ADR-0166 wires the LS as real Monaco providers, but the DEFAULT project is JS (`/workspace/src/main.js`, no tsconfig) — so `allowJs`-off means every LS query is honest-empty there, and a user wanting to TRY hover/def/refs/rename/quick-fix/format must hand-create a `.ts` file in the terminal first. No discoverable, ready-made surface to explore the feature.
user_story: As a rifty playground visitor (or someone evaluating the M12 agent's TS capability), I want to pick a "TypeScript" preset and immediately get a real .ts project where every shipped LS feature is demonstrable in-place — squiggle + Problems, hover, go-to-def into a dep `.d.ts`, cross-file references, rename, add-import quick-fix, organize-imports, format — without knowing to `printf > foo.ts` in the terminal first
sources: [ADR-0166, ADR-0078, docs/public/compat/ts-language-service.md]
code: [apps/playground/src/templates/registry.ts, apps/playground/src/templates/project-spec.ts, apps/playground/src/components/EditorHost.tsx, tests/e2e/ts-language-service.spec.ts]
---

## Context

The LS ships as real Monaco providers (Monaco built-in TS retired) for every ✅
compat row — but the default Vite/JS template seeds `main.js`, and the
out-of-program guard (correctly) returns honest-empty for a `.js` file with
`allowJs` off and no tsconfig. So the playground LOOKS like it has no TS
intelligence until the user manually creates a `.ts` file via the terminal
(explorer is read-only). There is no discoverable "try TypeScript" surface — a
UX gap, not an engine gap.

Templates are `ProjectSpec`s in `templates/registry.ts` (`vite` / `express-sqlite`
/ `socket-lab`), each with `entry` + `seedFiles`. A new TS-sandbox preset slots in
the same way.

## Options or Next

Honest acceptance (NO partial delivery): a new selectable `ProjectSpec` preset
(e.g. `typescript`) registered in `templates/registry.ts`, whose `seedFiles`
exercise EVERY shipped ✅ feature in the compat matrix, each anchored by a guide
comment in the seed code naming the gesture, so opening the preset and following
the comments demonstrates the whole surface. MUST cover all of:
- **Diagnostics + Problems** — a deliberate `number = string` (TS2322) → squiggle +
  a Problems-tab row.
- **Hover / quick-info** — a symbol whose type is worth hovering (incl. one typed
  by a seeded `node_modules` dep so hover/def reach a real `.d.ts`).
- **Go-to-(type-)definition** — a cross-file import + a dep symbol (def jumps into
  the seeded `node_modules/**/*.d.ts`).
- **Completions (+resolve)** — a member-access site (`.`) on a typed value.
- **Find-references / rename** — a symbol used across ≥2 seed files; plus a
  non-renameable spot to show prepare-rename rejection.
- **Signature help** — a multi-overload / multi-param call site.
- **Quick-fix** — a use of an unimported sibling symbol → "Add import …".
- **Organize-imports** — unsorted + unused imports to sort/drop.
- **Format document** — a deliberately mis-spaced block.
- A `tsconfig.json` (strict) so the diagnostics + resolution are the rich ones.

Plus: selectable from the preset UI alongside the existing templates; opening it
focuses a seed `.ts` file (not a `.js`); does NOT regress the default JS preset;
and an e2e (extend `tests/e2e/ts-language-service.spec.ts` or a sibling) asserts
the preset boots and at least the load-bearing features (diagnostics, hover/def,
references, quick-fix) actually fire on the seed code — never a static page that
only LOOKS interactive. If the preset boots a dev server/preview at all it reuses
the existing template machinery; the preview is incidental — the editor IS the
sandbox (a `kind` that needs no long-running server is acceptable).

Optional follow-on (own item if taken): a short in-editor "what to try" guide
(the seed comments may suffice for v1).

## Reversibility

REVERSIBLE — additive `ProjectSpec` + seed files + optional e2e; extends the
ADR-0078 template registry and ADR-0166's already-Accepted scope. No ADR (no
public API / dep / decision change). The umbrella
`toolchain-build/ts-language-service` and the compat page point here for the
"how do I try it" surface.
