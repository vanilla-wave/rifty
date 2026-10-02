# DEC-2: original-graph native IPC authority

Independent decision agent: ipc_brand_decision. Read-only source; no children.
Recommendation: supersede ADR-0501 snapshot authority entirely; keep ADR-0492
transport/receiver and Buffer side-reference identity decision. ADR-0502 is the
appropriate successor. Its SAB exemption is separately rejected by the later
`/tmp/vitest-ipc-sab-ceiling-decision.md` decision.

## Root evidence

Snapshot converts a changed-prototype Promise, WeakRef, FinalizationRegistry or
MessagePort into a successful ordinary record. Native V8 and browser structured
clone reject their native internal brands before own enumerable getters. Standard
JS exposes no side-effect-free general Promise brand query: `then` adds reactions
and changes rejection handling; constructor/prototype heuristics lose async and
custom-newTarget Promise instances. Mutation guards alone miss direct construction
with a custom newTarget. Do not expand Promise policy to hide this fault class.

## Chosen mechanism

Clone `{data: originalGraph, get buffers(){ return liveBufferReferences(); }}` once.
Native clone completely visits data before evaluating the later buffers getter.
Buffer allocation metadata retained only as WeakRefs supplies both old hidden
getter values and fresh getter-created Buffers. Native graph identity joins their
data clone nodes with side references; receiver reconstructs branded Buffer nodes
only when reached from data. No getter prewalk, opaque-value approximation,
Promise reaction or extra transport.

Shared per-realm metadata must span duplicated io bundles. Constructor hooks own
alloc/from/species allocations; native byte-view/prototype admission owns other
admitted Buffer creation paths. Current Buffer branding selects live refs; removal
of Buffer branding must not preserve stale allocation branding. Unrelated detached
views are excluded via captured TypedArray.values internal-slot validation.

Registry costs O(live byte views), packet copies live admitted Buffers. WeakRef and
FinalizationRegistry avoid persistent strong ownership. Production performance is
explicitly excluded from this goal; this cost is required to retain native opaque
brand authority plus one getter read. Do not claim unsupported arbitrary private
brand spoofing as a Native API or admitted construction path.

## Alternatives

- Accessor snapshot: killed by genuine opaque brands becoming records.
- Prototype/constructor tests: erased prototypes and custom newTarget defeat them.
- Promise.then probe: observable reaction/rejection side effects.
- Promise creation registry: async intrinsic Promises bypass the global constructor.
- Raw native clone: strips Buffer brand, including fresh getter-created Buffers.
- Native authority plus weak Buffer side references: chosen; no second getter read.

Browser-only cloneable host brands need named advanced.WebObject ceilings, not
false Native V8 ordinary-property serialization. Withdraw the repair-added Blob
positive claim explicitly in the successor/compat documentation. This changes a
repair decision, not the exact Vitest I1–I7 scenario; package proof stays mandatory.

## Executed proof

Node v24.16.0, commit e71b1b2494d2fa4cbea129c43f6d4e145f1e771f.
Command: `node --import tsx /tmp/vitest-ipc-native-authority-probe.mjs`.
Source/output: `/tmp/vitest-ipc-native-authority-probe.mjs`,
`/tmp/vitest-ipc-native-authority-probe.txt`.

```text
normal Buffer {"gets":1,"oldAlias":true,"freshAlias":true,"oldBuffer":true,"freshBuffer":true,"bytes":[7,8]}
Promise v8 Error getter-calls 0
Promise rifty DataCloneError getter-calls 0
async Promise v8 Error getter-calls 0
async Promise rifty DataCloneError getter-calls 0
custom newTarget Promise v8 Error getter-calls 0
custom newTarget Promise rifty DataCloneError getter-calls 0
WeakRef v8 Error getter-calls 0
WeakRef rifty DataCloneError getter-calls 0
FinalizationRegistry v8 Error getter-calls 0
FinalizationRegistry rifty DataCloneError getter-calls 0
MessagePort v8 Error getter-calls 0
MessagePort rifty DataCloneError getter-calls 0
```

Error class remains the existing native browser clone error; proof establishes
loud rejection before getter, the traced fault-row obligation. It does not claim
Node V8's exact error class/text. Fresh/old Buffer values and aliases are real io
instances, with no mock constructor or substitute graph in the mechanism probe.

Reproduction: sibling probe.mjs/txt retained. Replay SAB regression at reviewed e71 SHA; current tree intentionally throws the documented ceiling. Native oracle and source remain recorded.
