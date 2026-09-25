---
area: runtime-js
status: draft
title: "`import.meta.resolve` returns Node's URL for an absent file and throws Node's errors for a bare specifier under a non-`file:` parent"
created: 2026-09-25
why: Node resolves `import.meta.resolve('./nope.mjs')` to a URL without checking the file, where rifty throws `ModuleLoadError MODULE_NOT_FOUND`; a bare specifier under an http(s)/data: parent is Node's `TypeError` (`ERR_INVALID_URL` / `ERR_UNSUPPORTED_RESOLVE_REQUEST`), where rifty names a gap `NotImplementedError('module.import.meta.resolve.parent')`
sources: [docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md, docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-final-green.json, docs/adr/runtime-js/0449-carry-node-startup-options-and-worker-stdio-streams.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/module-loader/import-meta-resolve-parent.ts, packages/runtime-js/src/module-loader/esm-job-evaluation.ts]
---

## Context

REV-12 discoveries of `runtime-js/worker-threads-stdio-streams-empty-exec-argv`
(vitest-run-in-browser item 11; evidence §Discoveries, Final+GREEN Ecosystem
UX concern). Both loud in rifty, so no silent lie; both differ from Node.

- Absent file: Node v24.16.0 `import.meta.resolve('./nope.mjs')` → the file
  URL (`missing nope.mjs` row); rifty → `ModuleLoadError MODULE_NOT_FOUND`.
  vitest 4.1.11 `vm.CXMd5FHa.js:652` relies on Node's result, only in the
  `vmThreads`/`vmForks` pools (out of the goal's scope).
- Non-`file:` parent, bare specifier (`--experimental-import-meta-resolve`):
  Node v24.16.0 `import.meta.resolve('lpkg','https://example.com/x/')` (string
  or URL) → `TypeError ERR_INVALID_URL`; parent `data:text/javascript,1` →
  `TypeError ERR_UNSUPPORTED_RESOLVE_REQUEST`. rifty throws the named gap
  (`import-meta-resolve-parent.ts`, ADR-0449 §Explicit gaps), which
  misdescribes Node (nothing to implement: Node resolves nothing there).
  Relative specifiers under an http(s) parent already match.

Compat: `modules.md` `import.meta.resolve` row names both.

## Next

Owner runtime-js. Parity first: both rows as `process`/module cases (absent
file with and without the flag; http(s)/data: parent with a bare specifier).
The non-`file:` change replaces an ADR-0449 named gap with Node's errors — a
dated ADR-0449 correction note.
