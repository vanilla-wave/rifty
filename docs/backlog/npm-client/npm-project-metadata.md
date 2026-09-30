---
area: npm-client
status: draft
title: Match native npm project initialization and descriptive lock metadata
created: 2026-09-30
why: existing npm glue invents metadata in an empty project and omits native descriptive lock fields
user_story: As a developer consuming npm project files, I want npm-compatible metadata, but rifty creates different defaults and lock descriptions.
sources: [docs/backlog/npm-client/reference/npm-project-metadata-output.json, docs/backlog/npm-client/reference/native-save-output.json, docs/backlog/npm-client/reference/native-empty-output.json]
code: [packages/npm-client/src/linker.ts, packages/workbench/src/glue/npm-shell-command.ts, packages/workbench/src/glue/npm-package-json.ts]
---

## Context

Observed while preparing kit I9, outside its opened-project dependency-change
scenario (Contract+RED records the boundary). Compat ❌:
`docs/public/compat/package-tooling.md` project metadata row.

Native Node24.16/npm11.17 versus real rifty Shell/MemoryVfs/installer, same genuine
ms tarballs/HTTP packuments: native root lock records name, package entry records
license; rifty omits them. Bare npm install in an empty directory creates a lock
and no manifest; rifty creates no lock. npm install ms in an empty directory
creates only dependencies in package.json; existing rifty glue adds default
name/version/private. I9's requested save ranges/sections are repaired separately.

Reproduce from repo root:
`node --import tsx docs/backlog/npm-client/reference/npm-project-metadata-probe.mts`;
`node docs/backlog/npm-client/reference/native-save-probe.mjs`;
`node docs/backlog/npm-client/reference/native-empty-probe.mjs`.
Outputs alongside scripts; no mocked installer or tarball.

Owner: npm-client/Workbench npm metadata owner. Trigger: exact npm project-file
conformance pickup. No carrier prescribed; determine baseline field provenance
and initialization semantics from the recorded native reference.

Dedup2026-09-30: area titles/code, goal maps, traps and declined index have no
same metadata/empty-project item. Boundary: owned projection, not transport;
no new coordination proposed. Factual capture; no premise direction or user fork.

Final check2026-09-30: independent PASS at e631e4444; native probes rerun, frozen rifty source/output verified; no findings.
