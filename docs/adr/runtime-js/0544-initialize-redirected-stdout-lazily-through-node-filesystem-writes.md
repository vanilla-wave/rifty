# ADR 0544: Initialize redirected stdout lazily through Node filesystem writes

Status: Accepted
Date: 2026-10-20

## Context

esbuild-upstream-twin I2 requires actual Node 24 file/pipe/TTY CLI behavior.
Stock esbuild-wasm replaces fs.writeSync. Node's lazy file stdout captures
that replacement; reentrant Writable buffering eventually raises an engine
RangeError, which upstream consumes before exiting 0 with an empty file.
Preinitializing stdout produces a real bundle instead. All three upstream
versions reproduce; no package-specific empty-output rule is acceptable.

## Decision

- Shell redirection carries its file endpoint kind in typed terminal bootstrap
  metadata. Missing metadata retains existing pipe/TTY selection.
- File stdout initializes on first public access, captures the current builtin
  fs.writeSync and uses the existing Writable owner for queue/callback/error
  semantics. Raw fd writes retain their separate bootstrap-owned descriptor.
- Bootstrap/resize and default Console setup do not force the stdout getter.
  Console resolves its stream on first use, matching Node's lazy boundary.
- Reentrant writes use the same generic Writable queue; no esbuild name,
  version, byte suppression, hard-coded recursion limit or special exit path.
  Resource exhaustion is an engine result, not a synthesized upstream answer.

## Proof and limits

`file-stdout.spec.ts`: fs replacement before/after first stdout access and
finite reentrant writes against real Node file descriptors. Stock CLI matrix
keeps its expensive 30s native oracle; a short timeout falsely calls it a hang.
The remaining stdio end/destroy surface is a separate existing item; this work
carries the file writer behavior required by the real upstream entry.

## Corrections

- 2026-10-20 — pre-entry and Node entry bundles bind the current fs factory
  through existing PROCESS_FDS, at runNodeEntry; the public getter captures
  writeSync once. Console caches each logical process's sink on first use.
- 2026-10-20 — child stdio inheritance forwards raw descriptors and endpoint
  kind. Pipe-only spawn never evaluates a parent stdout getter.
- 2026-10-20 — Writable keeps a cursor in its existing queue, nulling consumed
  slots and compacting after an asynchronous boundary; no second queue or cap.
  Success callbacks receive null on Node's tick scheduler (registry process),
  not undefined on the platform microtask queue. Native fromWeb matrix confirms
  the old callback assertion was wrong; decoding/HWM assertions unchanged.

## Fault matrix

| Authority | Boundary / axis | Carrier |
|---|---|---|
| I2 / lazy file output | owned builtin projection / observable-order | before/after fs patch, console first-use/retention |
| I2 / reentrant file writes | Writable / observable-order | finite recursion + actual upstream CLI file rows; no engine-limit simulation |
| I2 / error and callbacks | Writable / observable-order | injected fs failure, callbacks before Promise; core stream fault suites |
| I2 / inherited file output | child stdio / sibling-drift | pipe spawn stays lazy, inherited output bypasses replaced stream, child captures its own fs |

No new transport: existing ordered Worker stdio and descriptor ownership remain.
