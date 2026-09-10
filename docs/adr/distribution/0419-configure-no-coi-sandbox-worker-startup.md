# ADR 0419: Configure no-COI sandbox worker startup

Status: Accepted
Date: 2026-09

## Context

SDK issues #328/#329; goal I1/I2. ADR-0383 already delivers preboot vm choice
through native Worker.name. VFS already mounts a selected native directory.

## Decision

- Toolchain SDK accepts `storage: { namespace?, persistence? }` and
  `startupTimeoutMs`. Omission: origin root, preferred OPFS, 10000ms.
  Persistence: required/preferred/ephemeral, matching the existing owner policy.
- Validate/copy config before effects. Namespace is one literal native component
  (ADR-0402); timeout a positive integer <= 2147483647. No timeout coercion.
- Extend Worker.name metadata, retaining legacy vm names. Runtime VFS boot uses
  the existing native-root mount and memory fallback; required never falls back,
  acquired preload failures always reject (ADR-0411). Return fallback reason.
- Extend `initBackend` with optional storage configuration; one shared namespace
  validator serves Workbench and runtime. Generic unconfigured boot unchanged.
- Existing host handshake timer owns construction/import/hydration/readiness,
  including replacement Workers on SDK restart. Deadline tears down peer and
  settles every pending call. Close/dispose has the same terminal ownership.
- Snapshot application, guest execution, service-worker registration and later
  persistence operation reporting are outside this startup deadline.

## Alternatives

- Native construction metadata: selected; available before entry imports/preload,
  even through wrapper/Blob entries; reuses ADR-0383 and no config handshake.
- New config message/ack before boot: unnecessary second bootstrap protocol.
- Host namespace override or second timer: violates I1/I2 public authoritative
  configuration; does not control worker preload or the shorter existing timer.

## Proof

`host-startup.fault.test.ts`, `sandbox-startup.contract.test.ts`, native
`no-coi-configured-startup.spec.ts`; evidence in startup unit reference.
