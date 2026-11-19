# ADR 0566: Select guest SharedArrayBuffer access per isolate call

Status: Accepted
Date: 2026-11

## Context

The owner requested a setting for guest access to SharedArrayBuffer. The manager requested preserving Node behavior by default. ADR-0563 places calls from different callers on one worker. ADR-0558 lets consumers load the same bundle themselves.

## Decision

Accept `allowSharedArrayBuffer?: boolean` on runCode and on the pre-load GuestHost record for custom embedders. Omitted or true retains the current guest. False makes construction and any wasm operation that would return a shared buffer throw `NotImplementedError('isolate-host.SharedArrayBuffer')`. Invalid option values reject. Atomics retains its native semantics. Both wait and waitAsync require a shared view, notify on a valid ordinary view returns zero, ordinary integer atomics still work.

The policy belongs to the fresh guest. The parent carries it on each attempt, including solo retries. The guest bundle applies it during bootstrap, before runtime modules can capture a producer. Custom embedders must supply a fresh realm and only the documented bridge values, including ordinary random bytes.

WebAssembly may use shared linear memory internally. JS can use ordinary wasm buffers and grow ordinary memory. Side channels and timer precision retain ADR-0563's posture.

## Alternatives

The process-wide V8 flag `--enable-sharedarraybuffer-per-context` alone leaves the shared wasm buffer accessible on isolated-vm 7.0.2 / Node 24.16.0. A host-wide policy would make a caller's choice depend on worker placement. Disabling wasm would also remove ordinary linear memory.

## Enforcement evidence

The host starts from a fresh bare V8 context. In restricted mode the injected shim removes the global before runtime feature detection. A real packed-bundle test counts reads of the original constructor during bootstrap: zero when restricted, positive in the default control. After bootstrap the public constructor reports the named gap.

A wasm memory, whether JS-created, grown or module-exported, exposes its backing store through its native prototype. The shim captures its buffer getter and both buffer conversion methods when present. Before returning a result it applies the captured ArrayBuffer byteLength getter. V8 accepts an ordinary backing store and rejects a shared one by internal slot. These checks run before the result reaches runtime or guest code.

The bridge supplies bytes in ordinary typed arrays. Typed arrays, DataView, Buffer, codecs and random bytes expose their existing backing store. The ordinary prototype constructor stays ArrayBuffer. Recovering a shared constructor through a buffer prototype would first require receiving a shared buffer. The controls exercise these sources and the packed embedder on Node 24.16.0 with isolated-vm 7.0.2, including both wasm conversions with V8's wasm RAB integration enabled.
