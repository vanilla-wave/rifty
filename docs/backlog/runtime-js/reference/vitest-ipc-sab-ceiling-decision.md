# DEC-2: shared backing-store advanced IPC ceiling

Independent decision agent: ipc_brand_decision. Read-only source review; no children.
Reviewed commit: e71b1b2494d2fa4cbea129c43f6d4e145f1e771f.
Native oracle: Node v24.16.0. Executed in this session.

## Recommendation

Accept ADR-0503 superseding only ADR-0502's SAB-backed Buffer exemption and
post-clone byte-copy decision. Keep original-graph native structuredClone,
weak Buffer side references, ordinary nonshared Buffer fidelity, transport and
receiver authority unchanged.

Reject every reached SharedArrayBuffer and shared-backed view, including Buffer,
with `NotImplementedError('child_process.serialization.advanced.SharedArrayBuffer')`.
Document this finite ceiling in compat; withdraw the locally added SAB-positive
claim/test. This is a changed decision, not a silent retargeting of a passing test.
I1–I7 exact Vitest scenario stays unchanged. Native supports shared-backed views;
the ceiling is a browser implementation gap, never a claim that Native rejects them.

## Discriminating evidence

Command: `node --import tsx /tmp/vitest-ipc-sab-ceiling-probe.mjs`
Source: `/tmp/vitest-ipc-sab-ceiling-probe.mjs`.
Actual output: `/tmp/vitest-ipc-sab-ceiling-probe.txt`.

```text
node v24.16.0
after native-v8 {"received":1,"source":2,"gets":1,"buffer":true,"shared":false}
after rifty-e71 {"received":2,"source":2,"gets":1,"buffer":true,"shared":false}
before native-v8 {"received":2,"source":2,"gets":1,"buffer":true,"shared":false}
before rifty-e71 {"received":2,"source":2,"gets":1,"buffer":true,"shared":false}
SharedArrayBuffer native rejects Error
Uint8Array native accepts Uint8Array false
DataView native accepts DataView false
Buffer native accepts Buffer false
```

`after`: data visits Buffer holding byte 1, then a getter writes byte 2. Native V8
copies byte 1 at the visit; e71 native clone keeps shared backing until post-clone
copy and incorrectly sends byte 2. `before`: an earlier getter writes byte 2,
then Buffer is visited; Native sends byte 2. Copying at serialization entry
instead would incorrectly send byte 1. Neither entry nor completion is Native's
per-value observation point.

## Alternatives

- Post-clone copy: killed by executed `after` case.
- Entry-wide shared-view pre-copy: killed by `before` Native observation.
- Per-visit custom graph serialization: new machinery; loses the native opaque
  brand authority that killed ADR-0501 unless reintroducing unsupported admission.
  Unnecessary for the exact Vitest scenario; do not reintroduce fake semantics.
- Named shared-backing ceiling: chosen, smallest honest mechanism. Requires no
  changes to getter execution, Promise reactions, graph identity or transport.

## Implementation/proof requirements

- Validate reached native views' backing stores before the Buffer side-reference
  exemption. Remove post-clone byte copying and its replacement map.
- Exclude shared-backed views from the weak Buffer side-reference listing so
  unrelated SAB-backed Buffers cannot enter normal packets as extra shared refs.
  Actual shared-backed data still reaches validation and throws the named ceiling.
- RED/GREEN named rejection tests: shared-backed Buffer, Uint8Array, DataView,
  nested Map/Set/ordinary-property occurrence; getter-mutated example above.
- Keep normal old/fresh hidden Buffer getter, cycles and alias proofs green.
- Physical parity asserts the explicit ceiling, not false Native equivalence;
  real exact Vitest forks/threads acceptance remains required.

Scope judgment: withdrawing a repair-added unproven SAB positive does not weaken
the user's exact-version goal. Existing shared-memory negative becomes complete
and honest. Record successor/dated correction, matrix negative and execution proof
under DEC-2 and REV-12; do not erase the observed defect.

Reproduction: sibling probe.mjs/txt retained. Replay SAB regression at reviewed e71 SHA; current tree intentionally throws the documented ceiling. Native oracle and source remain recorded.
