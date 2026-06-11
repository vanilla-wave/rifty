---
area: runtime-js
status: blocked
title: process.platform/arch honesty (ADR-0026) vs real-code branching — recorded tension
created: 2026-06-11
why: ADR-0026 returns platform='rifty'/arch='wasm' (honest), but ubiquitous platform==='darwin'|'linux'|'win32' and arch branches then misfire; reconsidering a recorded ADR is the one fork that must go through a decision subagent, so this records the tension, not a change
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0026]
code: [packages/runtime-js/src/builtins/process.ts]
---

## Context

ADR-0026 ratified honest values (`platform='rifty'`, `arch='wasm'`). The 2026-06 strategy research
flags this as a self-inflicted adoption wall: real npm code branches on `platform`/`arch` constantly
(postinstall scripts, binary selection, path handling), so honest-but-unexpected values misfire. The
counter-argument the research itself notes: code branching on `platform` usually does so to pick a
native binary that won't run in-browser anyway, so "fixing" the branch may just defer the failure.
This is a recorded-decision reconsideration — per the process rules it is NOT settled inline or by a
plain backlog edit; it requires a decision subagent that reads ADR-0026 + the new evidence and
produces a superseding ADR (if any). Blocked on that.

## Options or Next

- Gate: evidence of real breakage attributable to the honest values (not hypothetical).
- Then: spin a decision subagent → superseding ADR deciding default `'linux'`/`'x64'` vs an opt-in
  shim vs status-quo.
- Hard boundary in any reversal: forbid per-package platform overrides (that boundary is the slope
  into the forbidden curation); expose rifty's true identity via a separate field.

## Reversibility

IRREVERSIBLE — contradicts a merged ADR (rule 3); resolution = decision subagent + superseding ADR.
Recorded here; blocked.
