---
area: shell
status: active
title: Shell command manifest registry for fidelity and tooling
created: 2026-06-25
why: Command names, implemented flags, loud ceilings, stdin modes, completion names, and future compat rows are not described by one source of truth.
user_story: As a rifty maintainer, I want each shell command to declare its supported surface and explicit gaps once, so completion, compat docs, parity tests, and no-silent-stub claims stay aligned.
sources: [Q-2026-06-25-shell-research, ADR-0088, ADR-0093, docs/backlog/process-meta/compat-matrix-coverage-debt.md]
code: [packages/shell/src/builtins.ts, packages/shell/src/language-service.ts, docs/public/compat/README.md]
---

## Context

Today `CORE_COMMAND_NAMES`, builtin registration, completion, command docs, and
compat visibility are separate concerns. ADR-0093 requires explicit parity and
fixture discipline, but the command inventory is not yet represented as data.

This item is not only a file-layout cleanup; `command-file-layout` tracks moving
command implementations into separate files. This item tracks a descriptor
registry for fidelity metadata and tooling.

## Options or Next

1. Define command descriptors: name, aliases, command implementation,
   implemented flags, loud ceilings, stdin mode, parity tier, completion hints,
   and compat rows.
2. Generate or derive `CORE_COMMAND_NAMES`, builtin registration, and completion
   command names from the descriptors.
3. Use the manifest to audit `NotImplementedError` feature names and compat ❌
   rows for unsupported command surfaces.
4. Keep host-registered custom commands simple and separate unless they need
   manifest metadata later.

## Reversibility

REVERSIBLE as internal metadata if exported shell APIs stay stable. Generated
public compat docs should be reviewed through the normal docs process.
