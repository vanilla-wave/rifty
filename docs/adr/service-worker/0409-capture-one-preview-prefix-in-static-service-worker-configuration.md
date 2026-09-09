# ADR 0409: Capture one preview prefix in static service worker configuration

Status: Accepted
Date: 2026-09

## Context

Goal I5/scenario3 needs public Vite iframe/assets/HMR under /sandbox/ without
root SW scope or guest source edits. ADR-0036 owns canonical io addressing;
ADR-0031/0040 version the SW frames/routing; ADR-0189 owns the generic injected
WebSocket bridge; ADR-0263 owns early deployment validation.

Native Chromium148/Node24.16 probes establish: controlled iframe root-absolute
subresources reach its SW even outside scope; a new out-of-scope document
navigation does not. SW script query persists through real stop/restart/reload.
Current Workbench control proof accepts a same-version wrong-prefix controller;
adding expected-prefix equality to its existing PONG matcher refuses it and
follows the replacement through the existing controllerchange path.
Executed sources/results: docs/backlog/service-worker/reference/workbench-preview-prefix-pickup.md.

## Decision

- Add deployment.previewPrefix?:string to both Workbench entrypoints. io owns
  the canonical absolute pathname prefix: one leading slash, no backslash,
  query/fragment, ASCII controls or encoded separators. Append the trailing slash
  before URL pathname parsing: dot segments/Unicode normalize, literal trailing
  spaces survive as %20. Preserve literal
  percent spelling and current decimal-port admission. One public validator
  checks explicit routes within the selected same-origin SW scope before effects.
- Omission keeps /preview/ and the original normalized SW URL, including opaque
  query bytes. Omitted prefix does not newly reject narrow-scope Node-only hosts.
  Explicit out-of-scope /preview/ rejects; omission never silently derives a
  prefix from scope. Capture/freeze the selected value in existing owner config.
- Static SW configuration uses reserved script query __rifty_preview_prefix.
  Service-worker exports configurePreviewServiceWorkerUrl and
  previewPrefixFromServiceWorkerUrl; the writer appends raw encoded key/
  value without reserializing existing query. Explicit reserved-key collision
  rejects; SW duplicate/invalid values fail loudly. Absent key defaults /preview/.
  SW captures once from its own location and supplies that SAME value to routing
  and control PONG. Host serves the copied script at its query-bearing URL.
- Optional PONG previewPrefix defaults /preview/. Existing current-controller,
  transferred-port/version proof also compares expected prefix at startup and
  preview admission. No echoed request claim, new handshake, timer or config map.
  SW routing version becomes7, frame remains1 under ADR0031/0040 additive rule.
- Canonical io parser/builder parameterize all preview registry URL producers,
  SW direct/referrer routing and injected WS prefix recognition. Existing /preview/
  regex remains a default export. io exports DEFAULT_PREVIEW_PREFIX, normalizePreviewPrefix,
  previewPrefixPattern and buildPreviewPath; parsePreviewPath takes optional prefix.
  Guest localhost HTTP URLs, paths and query,
  root-relative guest WS and external native WS retain their current semantics.
- Existing page→net preview request metadata carries optional defaulted prefix,
  covering both Request and dispatchStruct. Net frame version2 remains under its
  additive-default rule. Run scope remains an independent identity. HTML bridge
  injection reuses current codec, drain deadlines, header corrections and marker.
  No guest-bootstrap/env/HMR-config changes or new request dispatcher/cache.

## Alternatives

- Immutable script URL + existing PONG proof: chosen. Native restart preserves
  configuration before fetch/owner lookup; opaque caller queries remain exact.
- Mutable page configuration/replay: adds SW-restart ordering, per-owner config
  lifetime and conflicting-prefix coordination; unnecessary under native result.
- Host recompiles SW or uses root scope: contradicts I2/I5.
- Rewrite guest assets/navigation or force Vite base: unnecessary for controlled
  subresources and contradicts unchanged source URLs. No arbitrary out-of-scope
  navigation/redirect promise is added.

## Proof

Default and narrow absent-option controls; exact opaque-query roundtrip, malformed
configuration before effects, stale-controller replacement and native restart;
all URL producers, direct/referrer/WS paths, existing owner/protocol refusal.
Mandatory packed static host under /sandbox/ with copied assets, snapshot-only
and selected namespace: real Vite assets/build/HMR without reload; unrelated host
pages/API/files exact. Reuse existing authorizations/lifecycle, no new coordinator.
