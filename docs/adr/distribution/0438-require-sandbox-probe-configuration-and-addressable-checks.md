# ADR-0438: Require sandbox probe configuration and addressable checks

Date: 2026-09-16. Status: accepted.

## Context

A real non-COI SDK host ran ADR-0437's unpublished API: omitted assets produce an
unusable inconclusive report; mode reason strings lose the identity of checks.
Evidence and independent DEC-2 decision:
`docs/backlog/distribution/reference/workbench-sandbox-support-consumer-implementation.md`
and `docs/backlog/distribution/reference/workbench-sandbox-support-consumer-evidence.md`.

## Decisions

1. Supersede ADR-0437 decision 2's sentence "Omission reports incomplete
   asset-dependent checks": require `probeBaseUrl`; omission rejects with
   `TypeError` naming the option before any probe starts. Decision 1's signature
   becomes `checkSandboxSupport(options)`; its report sections/states remain.
2. Mode `reasons` becomes `unmet`; `unmet` and `limitations` are
   `readonly SandboxSupportCheckId[]`. Each ID resolves to a `checks` row;
   its reason and native error remain there. No duplicated check objects.
3. Keep ADR-0437's composition requirements and resource lifecycle. Hosts compose
   their own requirements from `checks`; SW-skipping hosts filter SW observations.

## Alternatives and consequences

- Uniform omission text retains a call that can never reach supported. Required
  configuration removes that permanent host mistake from inconclusive.
- Objects duplicate `checks`; text prefixes require parsing. IDs are sufficient
  for the accepted gate and UI. No new `require:` or SW opt-out API needed.
- Source consumers must supply the URL and replace reason-string access with ID
  lookup. This API is unpublished; existing released consumers are unaffected.
