# ADR 0450: Project vm script offsets through one owned stack hook

Status: Accepted
Date: 2026-09

> TL;DR: host-realm `vm.runInThisContext` / `vm.Script` honour `lineOffset` /
> `columnOffset` by carrying them in a per-script `sourceURL` identity and
> projecting every CallSite of that script through one rifty-owned
> `Error.prepareStackTrace` accessor; sandbox entry points stay loud.

## Context

vitest 4.1.11 evaluates every test module with
`vm.runInThisContext(prefix + code, { filename, lineOffset: 0, columnOffset: -prefix.length })`;
vite 8.0.16's module runner assigns its own `Error.prepareStackTrace` and reads
CallSite getters before its source-map lookup. Rifty throws for any non-zero
offset. Node applies offsets in V8's script origin: every line shifts by
`lineOffset`, physical line 1 by `columnOffset`, never clamped; getters
return null for a value ≤ 0 (evidence:
`docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md`).

Rifty's host-realm script is an indirect `eval` + `sourceURL`: no origin
offsets. Chromium 148 has no embedder stack callback, starts with
`Error.prepareStackTrace` undefined, honours an accessor there (getter per
format, receiver `Error`), and freezes every `CallSite.prototype` method
(non-writable, non-configurable).

## Candidates

1. **Source prefix** (newlines / spaces before the code) — minimal interface,
   native in every formatter. Killed: negative offsets (vitest's
   `columnOffset`) have no text form.
2. **Filename-keyed offset map + rendered-string rewrite** (PR #349). Killed:
   offsets belong to the script (same filename, other offsets — evidence P2);
   guest hooks read raw CallSites.
3. **Encoded `sourceURL` + permanent data-property dispatcher** (PRs #351,
   #352). Killed: vite's `Error.prepareStackTrace = …` replaces it, so vite
   reads the encoded URL from `getScriptNameOrSourceURL()` and misses the
   module's source map (vite `module-runner.js:829,954`).
4. **Patch `CallSite.prototype` getters** — would reach every hook. Killed:
   Chromium rejects the write (`Cannot redefine property: getLineNumber`).
5. **Per-script identity + owned accessor** — chosen.

## Decision

1. **Validation.** `lineOffset` / `columnOffset` are Node's `validateInt32`
   (`ERR_INVALID_ARG_TYPE`, `ERR_OUT_OF_RANGE`) on every `vm` entry point, in
   Node's order (lineOffset first; `compileFunction` columnOffset first).
   `vm.Script` stores its constructor offsets; `Script#runInThisContext`
   options carry none.
2. **Identity.** A non-zero-offset script is evaluated with a `sourceURL`
   carrying its offsets and its percent-escaped filename (Node's
   `evalmachine.<anonymous>` when absent). Stateless: no registry; two scripts
   share an identity only when filename and offsets are equal. Zero offsets
   keep today's `sourceURL = filename`, unless the filename itself starts with
   the identity scheme (then encoded, never read back as offsets).
3. **One owner of `Error.prepareStackTrace`.** The first offset script (and
   every later one, if the owner was removed) installs a configurable,
   non-enumerable accessor that keeps the guest-assigned value. Getter: a
   guest function → a cached wrapper that calls it with projected CallSites;
   anything else → a default named `ErrorPrepareStackTrace` (length 2) that
   renders Node 24's `defaultPrepareStackTrace`
   (`Error.prototype.toString` header + `\n    at ` frames). Setter stores
   the unwrapped value (wrapper → its function, default → unset).
4. **Projection.** A CallSite whose `sourceURL` is an offset identity is
   handed out as a Proxy (prototype and names are CallSite's): line, column,
   enclosing line/column shift per Node with null for ≤ 0;
   `getScriptNameOrSourceURL` / `getEvalOrigin` return the filename;
   `toString` rewrites the identity to `filename[:line[:col]]` (zero omitted,
   negatives printed). Other CallSites pass through untouched.
5. **ADR-0136 window** reads and writes the slot through the owner while it is
   installed, so its restore sees its own dispatcher and never deletes the
   owner.
6. **Sandbox entry points** (`runInContext`, `runInNewContext`,
   `Script#runInContext` / `#runInNewContext`, `compileFunction`) keep named
   `NotImplementedError`s for valid non-zero offsets (ADR-0142 engines have no
   script origin).

## Consequences

- vitest's module evaluator runs; vite's hook and default stacks show Node's
  positions; no package-specific code.
- Recorded divergences once an offset script ran (compat ❌): the slot is an
  accessor (Node: data property); reading it back after assigning a function
  yields a wrapper that delegates to it, after assigning a non-function the
  default (Node: the assigned value).
- `delete Error.prepareStackTrace`, an error formatted inside a hook, or stack
  overflow bypasses the owner: offset frames show the encoded identity
  (visible, never a plausible `file:line:col`) until the next offset script.
- `eval` / `new Function` inside an offset script: their eval origin shows the
  encoded identity without position (Node: `file:line:col`).
- Unchanged, outside this ADR: eval-shaped host-realm frames, the absent
  default `displayErrors` decoration, and Chromium's `undefined` default hook
  before any offset script (evidence §Discovered).
