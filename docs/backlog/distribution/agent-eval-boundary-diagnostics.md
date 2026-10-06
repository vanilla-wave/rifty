---
area: distribution
status: draft
title: Map observed environment differences and Rifty capability boundaries
created: 2026-09-27
why: Aggregate passes on the pilot cannot reveal recovered tool obstacles or where realistic coding workflows stop being reliable in Rifty.
epic: agent-code-quality-evaluation
blocked_by: [distribution/agent-eval-corpus-expansion]
sources: [ADR-0434, docs/backlog/distribution/reference/agent-eval-boundaries-refine-evidence.md]
code: [tools/agent-bench/src/runner.ts, tools/agent-bench/src/report.ts, tools/agent-bench/tests/baseline-probes.ts, packages/agent/src/prompt.ts]
---

## Context

The existing 42-run diagnostic retains tool calls/results but does not produce
an operation-level difference catalog or graded search for capability limits.
User explicitly requests both, and rejects closing on a few easy passes.
Research found native curl/sed use; Python was not detected by the limited
trace scan. Standalone Shell rejects all three, but this is not public-browser
host evidence. Preserve that distinction, rather than manufacture a live defect.

## Diagnostic route

- I10: inspect actual tool calls/results across all participants, including
  successes following errors. Record exact command/flags/API/tool protocol,
  host/version, source trace or probe, native/Rifty outcomes, recovery and
  supported impact. Flag parser uncertainty; no universal shell parser needed.
  Distinguish unavailable executable, unsupported flag/API, semantic mismatch,
  host policy, output/context limits and unknown cause. Candidate extraction
  is not proof; verify relevant operations in the actual selected environments.
- I11: use several real-task families with explicit successive levels. Vary
  engineering interactions/context, dependencies/tool needs and resource
  pressure as separate dimensions. No file-count proxy, disguised repeated
  CRUD or artificially required Python command as the whole ceiling result.
- At PICKUP, declare levels, settings, stopping bounds and interpretation before
  execution. Extend existing scripts, task cards and report structures. Keep
  settings matched across lanes within a level; name any changed dimension.
  Saturated easy levels require escalation, not goal completion.
- Freeze selected boundary cases and run fresh repeated confirmation with
  reference controls. A native-only pass is a candidate gap; discriminate the
  relevant operation/host failure before assigning a runtime cause. A task
  rescued by Node after a failed Python call stays successful, with obstacle
  and recovery separately visible.
- Retain diagnostic selection provenance and every attempted level. Adaptive
  selection/fresh repeats do not make the sample representative; report this
  search separately from I4's comparison. Both fail means a shared observed
  limit or unknown cause; all pass means only a tested lower bound. Finite
  stopping is justified with evidence, never an absolute-ceiling claim.

The catalog and boundary profile are required goal results even when the
validated pilot closes I5. This item measures gaps; it does not silently add
runtime features or tune prompts to hide unavailable commands. User-facing
working capability and own-environment scoring remain unchanged.
