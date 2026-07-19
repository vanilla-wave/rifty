---
area: playground
status: draft
title: Workbench implicit Vite project lost its pre-split ESM package scope
created: 2026-07-15
why: the old project package builder emitted type:module, while projects.vite() now adds Vite without choosing a package type
user_story: As a Workbench consumer running Node .js scripts inside an implicit Vite project, I want the same module classification the pre-split project had, but today those scripts classify as CommonJS unless I supply package.json.type myself.
epic: vite-knowledge-boundary
sources: [PR-136-recut, commit-9e6ba393, apps/playground/src/workbench/project-definition.ts]
code: [apps/playground/src/workbench/project-definition.ts]
---

## Context

Before the Workbench split, the Vite project package builder always wrote
`"type":"module"`. The new public definition normalizer preserves a supplied
manifest and adds only the pinned Vite dependency; an absent manifest becomes a
package with no `type`.

Real Vite can still load the generated ESM-looking `vite.config.js` through
its standard `require.extensions['.js']` + `module._compile` path (ADR-0269),
so changing the config extension/text or injecting `type` merely to unblock
Vite would hide the runtime bug. The remaining difference is separate and
user-visible: direct Node execution of project `.js` files now chooses CJS
where the pre-split implicit project chose ESM.

Whether a public `projects.vite()` factory may add `type:module` only for a
missing manifest, also for a manifest with no `type`, or never mutate that
field is a public behavior decision. Refine and record that decision before
implementation; do not couple it to Vite config loading.
