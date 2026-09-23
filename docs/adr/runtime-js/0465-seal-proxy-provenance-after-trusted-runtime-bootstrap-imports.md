# ADR 0465: Seal Proxy provenance after trusted runtime bootstrap imports

Status: Accepted
Date: 2026-09-23

Supplement ADR-0453: capture still closes before guest execution; this repairs
the phase placement for separately bundled trusted URL bootstraps.

## Evidence

Fresh production5448 failed owner startup: kernel installNodeRuntime sealed
capture before importing workbench-owner-bootstrap's second runtime bundle.
Its acquireDuringBootstrap then threw "Proxy provenance bootstrap is sealed".
Dev ESM shares one module instance and concealed the defect. Five production
attempts reproduced it; `/private/tmp/rifty-vitest-prod-candidate.log` and the
owner-boots-on-prod-build error context retain the actual emitted chunk trace.

The new real pre-entry/second-module fault test reproduced that error before
repair; plain URL/source guest controls already rejected late acquisition.

## Decision

- Kernel URL entry descriptors may carry host-owned `role:'runtime-bootstrap'`.
  Kernel transports the role unchanged; runtime-js interprets it. It is never
  inferred from argv, filename or guest environment.
- Node pre-entry defers closure only for that role or the existing typed
  node-entry path. Unmarked URLs and source entries retain immediate sealing.
- Workbench owner and dev-server producers mark their trusted entry. Their
  entry body calls public close-only `sealNodeRuntimeBootstrap()` after static
  imports, before package work or owner service startup.
- The TypeScript relay is the third reachable sibling. Its producer marks the
  role; bootTsLanguageServiceWorker closes capture before creating the endpoint
  and registering requests, including its existing auto-boot path.
- No raw constructor/marking capability is exported; acquisition remains
  rejected after closure. Closing cannot reopen the existing owner.

The role is an assertion by the trusted deployment/entry producer, which already
selects the executable URL. Node Worker/fork options cannot select it. A host
using this role must close before guest work; all three in-repo producers have
explicit closers and tests. No new registry, token exchange or unseal path.

## Sweep / alternatives

Owner, dev-server and TS URL bundles all import runtime-js after kernel
pre-entry. Typed node-entry already closes in runNodeEntry; standalone runtime
workers already close after their static graph. WASI entries do not enable
Node Proxy installation. Test-harness/raw URL entries remain guest-default.
Kernel spawn and structured-clone init preserve the descriptor; no separate
role schema or lossy assembler exists.

Rejected: skip all sealing, reopen a sealed owner, export native Proxy, or infer
trust from a URL spelling. Deduplicating every Worker build graph is a separate
packaging effort; it does not replace this explicit guest boundary.

## Verification

Real pre-entry/second-module fault: RED→GREEN; plain URL/source controls stay
sealed. Producer assertions pin all three roles; TS endpoint boots before
handling requests. Targeted93PASS; producer/runtime227PASS plus one migrated
exact-role assertion, failed file rerun27/27PASS. Four package typechecks,
architecture, size and Biome PASS.

Fresh production5449:8/8PASS3.3m, including owner LIVE, Buffer identity, real
TypeScript editor F12/diagnostics and Webpack install/HMR/reload. Compiler pin
adds54bytes (close import/call); unchanged global cap and10 negative payload
testsPASS. RED/GREEN logs: `/private/tmp/rifty-prod-bootstrap-phase-*`,
`/private/tmp/rifty-prod-bootstrap-producer-*`,
`/private/tmp/rifty-vitest-prod-bootstrap-green.log`.
