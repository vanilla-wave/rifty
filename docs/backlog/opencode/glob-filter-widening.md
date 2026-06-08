---
area: opencode
status: parked
title: Widen vfsGrep include filter from suffix-match to real glob
created: 2026-06-08
why: include is a deliberate suffix/extension match, not minimatch; full glob is a new dep (IRREVERSIBLE), deferred behind ratification
sources: [audit-digest]
---
## Context
The ⚠ row in the tool-ceiling table: `vfsGrep`'s `include` option is a minimal suffix/extension match (e.g. `'*.ts'`), NOT minimatch / full glob. Deliberate for a ceiling marker — a full glob engine would be a new external dependency.
## Options / Next
Keep the suffix match for the marker; widen to real glob ONLY behind explicit ADR ratification, since adopting a glob engine is a new dep (IRREVERSIBLE by reversibility rule 2) and out of scope for marking the line. Next: no action until the facade search tool needs real glob semantics at scale.
## Reversibility
IRREVERSIBLE to adopt a glob dep (rule 2) → deferred behind ratification. Parked.
