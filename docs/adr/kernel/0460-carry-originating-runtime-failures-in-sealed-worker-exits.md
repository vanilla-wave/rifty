# ADR 0460: Carry originating runtime failures in sealed Worker exits

Status: Accepted
Date: 2026-09

Extends ADR-0039's runtime policy boundary, ADR-0332's single terminal owner,
and ADR-0449's Worker lifecycle. Native Worker preload failures emit the actual
error before exit 1; status 1 alone is not error evidence.

## Decision

The existing kernel entry catch records an optional `{reason}` fatal payload;
explicit process-exit signals never produce it. The existing output-attested
exit frame carries it through the same ProcessManager terminal outcome. Stdio
settlement/EOF still precedes terminal delivery. Runtime Worker projects this
payload into `error` before `exit`; ordinary child_process retains its exit tuple.
No new channel, public IPC message tag, acknowledgment, retry or terminal owner.
Presence carries thrown `undefined` without inventing an Error.

`setKernelFatalErrorSerializer` is the runtime policy seam, installed by the
existing Node pre-entry hook before guest code. Runtime-js owns a Worker-specific descriptor projection: native Error.isError
recognizes cross-realm/severed-prototype Errors; Node24's constructor-name
selection and descriptor rules preserve numeric code, requireStack and custom
data. RPC serializeRuntimeError is intentionally not reused: its diagnostic
subset loses these fields. Cloneable non-Errors stay values. Native Node24 inspects
uncloneable non-Errors, omits function Error code and inspects function causes;
runtime util.inspect supplies those strings. Custom-inspect hooks remain the
existing util-surface-completions boundary: a named
`NotImplementedError('worker_threads.error.custom-inspect')`, not an ignored hook.
An actual serialization failure (measured throwing function-name getter) emits
Node's ERR_WORKER_UNSERIALIZABLE_ERROR before exit1. Kernel remains Node-agnostic and
clone-checks the payload before publishing. A projection/clone failure carries
its real serialization error, so it cannot strand terminal settlement.

## Sweep and rejected alternatives

- The entry/drain catch is the provenance-loss point: it previously retained
  only `{threw,code}` after writing stderr. Preload, entry and drain failures
  therefore share this repair.
- Inferring an Error from exit 1 or parsing stderr loses provenance; rejected.
- User `process.send` error frames can be forged and race independent terminal
  streams; rejected. The existing private output attestation owns the evidence.
- Kernel Node Error/inspect policy would invert ADR-0039; rejected. Existing
  pre-entry/drain hooks establish the runtime-owned projection pattern.
- ProcessManager already owns output cut, descendant retirement and terminal
  settlement. Its optional fatal payload adds no second lifecycle state machine.

## Proof

`worker-thread-startup-options.spec.ts`: native Node and fresh Chromium;
missing/throwing preloads, typed name/message/code/stack plus stdout-before-error,
explicit exit1 and handled uncaught controls, non-Error/undefined/function/Proxy
throws, uncloneable Error code/cause. Kernel fault tests reject malformed or
unattested fatal frames and retain terminal exit after projection failure.
