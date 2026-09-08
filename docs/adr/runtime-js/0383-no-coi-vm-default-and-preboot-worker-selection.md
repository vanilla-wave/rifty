# ADR 0383: No COI VM default and preboot worker selection

Status: Accepted
Date: 2026-09-07

## Context

PR #310 records the user's choice: no-COI toolchain defaults to rewrite,
with explicit quickjs opt-in and visible degradation. Packed Chromium baseline:
SDK default/quickjs/rewrite all use QuickJS, report no vm row, and fetch WASM
at boot and restart. RuntimeOptions currently sends vm-config after ready,
which cannot govern preload before readiness (ADR-0352 D5).

## Decision

1. Supersede ADR-0142 D1's default only for the no-COI toolchain realm:
   rewrite. Generic remains quickjs; existing engine implementations and
   documented divergences stay unchanged. Env/global fallback precedence is
   retained when no explicit runtime override is supplied.
2. Add `ToolchainCreateSandboxOptions.vmEngine?: 'quickjs' | 'rewrite'`.
   The SDK selects the supplied value or rewrite, sends it at construction,
   retains it on restart, and reports the actual selected engine. Rewrite row
   is degraded (direct-eval host leak, host globals, host instanceof); QuickJS
   selects the existing real-realm behavior and its existing documented limits.
3. Host RuntimeOptions.vmEngine uses native WorkerOptions.name, reserved exact
   labels `rifty-vm-engine=quickjs` / `rifty-vm-engine=rewrite`. Worker reads
   self.name before boot; omitted/arbitrary raw-worker names do not override
   engine selection. No generic config envelope, URL rewriting or handshake.
   The diagnostic Worker name/self.name changes when an option is supplied.
4. Preload QuickJS only when resolved engine is quickjs. Keep the existing
   preload-failure error behavior; first eval still waits for boot. Retain
   the legacy vm-config frame handler, but the host no longer uses that late
   frame as bootstrap configuration (ADR-0352 D5 now holds).

## Alternatives

- Native name: chosen; actual Chromium HTTP/blob × omitted/custom/two reserved
  labels passes 8/8, before and after dynamic import, URLs unchanged.
- URL fragment: works for HTTP/blob, but requires URL editing for no API gain.
  Query fails for Blob workers. Probe recorded in the item evidence.
- Boot-awaited init: needs readiness handshake; current direct Workers boot
  without any host init message, and an early unacknowledged message can arrive
  before the dynamically imported runtime listener.

## Proof

`docs/backlog/distribution/reference/vm-worker-name-probe.mjs` and its raw JSON
pin Node v24.16.0 / Chromium 148.0.7778.96. Packed SDK browser proof exercises
engine semantics, request counts and restart on HTTP and Blob worker URLs;
existing vm conformance/parity remain the engine authority.

Blob proof publishes the existing QuickJS WASM URL as an absolute bootstrap
global before importing the entry (ADR-0352); root-relative fetch has no base
in a Blob worker. This is artifact publication, not a new engine option.
