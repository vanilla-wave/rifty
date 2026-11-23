# ADR 0566: Select guest SharedArrayBuffer access per isolate call

Status: Accepted
Date: 2026-11

## Context

The owner replied «Я хочу настройку на это.» to the manager’s «SharedArrayBuffer гостю оставлен.» The manager interpreted this as choosing guest access per call with Node behavior by default. ADR-0563 places calls from different callers on one worker. ADR-0558 lets consumers load the same bundle themselves.

## Decision

Accept `allowSharedArrayBuffer?: boolean` on runCode and on the pre-load GuestHost record for custom embedders. Omitted or true retains the current guest. False removes the global property. Feature detection sees `typeof SharedArrayBuffer === 'undefined'`, so programs can take their fallback. Direct construction by the unbound name throws ReferenceError. A wasm operation that would return a shared buffer throws `NotImplementedError('isolate-host.SharedArrayBuffer')`. Invalid option values reject. Atomics retains its native semantics. Both wait and waitAsync require a shared view, notify on a valid ordinary view returns zero, ordinary integer atomics still work.

The policy belongs to the fresh guest. The parent carries it on each attempt, including solo retries. The guest bundle applies it during bootstrap, before runtime modules can capture a producer. Custom embedders must supply a fresh realm and only the documented bridge values, including ordinary random bytes.

WebAssembly may use shared linear memory internally. JS can use ordinary wasm buffers and grow ordinary memory. Side channels and timer precision retain ADR-0563's posture.

## Alternatives

The process-wide V8 flag `--enable-sharedarraybuffer-per-context` alone leaves the shared wasm buffer accessible on isolated-vm 7.0.2 / Node 24.16.0. A host-wide policy would make a caller's choice depend on worker placement. Disabling wasm would also remove ordinary linear memory.

## Enforcement evidence

The host starts from a fresh bare V8 context. In restricted mode the injected shim removes the global before runtime feature detection. The packed-bundle bootstrap test observes zero reads of the original SAB binding when restricted and positive reads in the default control. It observes precisely one lookup of WebAssembly.Memory while the original buffer getter is installed in restricted mode, by the shim itself.

A wasm memory, whether JS-created, grown or module-exported, exposes its backing store through its native prototype. The shim captures its buffer getter and both buffer conversion methods when present. Before returning a result it applies the captured ArrayBuffer byteLength getter. V8 accepts an ordinary backing store and rejects a shared one by internal slot. These checks run before the result reaches runtime or guest code. The guarding methods retain the native names and non-constructability. Inspecting their function source shows the JS guard in restricted mode.

The bridge supplies bytes in ordinary typed arrays. Typed arrays, DataView, Buffer, codecs and random bytes expose their existing backing store. The ordinary prototype constructor stays ArrayBuffer. Recovering a shared constructor through a buffer prototype would first require receiving a shared buffer. The controls exercise these sources and the packed embedder on Node 24.16.0 with isolated-vm 7.0.2, including both wasm conversions with V8's wasm RAB integration enabled. The packed-guest test pins the prototype’s own keys and exercises all three producers with guest replacements for Object.prototype.toString, Reflect.apply and the ArrayBuffer byteLength getter.

## Decisions

- 2026-11-19 — external review, manager’s amendment. The previous throwing global made feature detection select an unavailable path. The reference for an intentionally disabled global is live Node with `--enable-sharedarraybuffer-per-context`. Wasm backing buffers retain rifty’s stricter named refusal.
