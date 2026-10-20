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
