---
area: runtime-js
status: draft
title: ESM ModuleJob linking parity for export validation, cycles, and export-star
created: 2026-07-19
why: ESM linking skips Node's named-export and TDZ validation, while cyclic jobs can partly fulfil, rerun side effects after failure, or publish ambiguous star exports
user_story: As a developer importing a real ESM package graph, I want each strongly connected component to link and fail like Node, but today a cycle can expose a partial namespace or run module bodies more than once.
blocked_by: []
sources: [PR-153-post-merge-runtime-audit, Node-v24-module-parity]
code: [packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/esm-ast.ts]
---

## Context

Rifty rewrites static imported bindings to namespace property reads without first validating that the source exports the requested name; missing names and cyclic TDZ access can therefore become `undefined` or fail after side effects where Node rejects during linking/evaluation at the exact graph boundary. The same independent audit reproduced SCC members receiving different outcomes or rerunning bodies after failure, ambiguous star names being published, and cyclic star bindings remaining `undefined`. These are one ModuleJob/linking fault class, not Workbench lifecycle work; the minimized RED fixtures still need to be committed before implementation.

## Refinement path

- Minimise and commit RED parity for missing named/default imports and re-exports, TDZ reads, SCC linking/evaluation order, top-level-await rejection, sticky failure identity, one-time side effects, concurrent imports, and coherent invalidation.
- Pin star-export fixed-point computation, explicit-export precedence, duplicate-same-binding convergence, ambiguity exclusion, namespace keys/descriptors, and cycles across re-export-only modules.
- Choose one graph/job owner before changing records; a patch that fixes one traversal order while leaving sibling SCC or star rows divergent cannot close the item.
- Update the modules compatibility matrix from ⚠️ only when the finite parity matrix is green against the supported Node line.
