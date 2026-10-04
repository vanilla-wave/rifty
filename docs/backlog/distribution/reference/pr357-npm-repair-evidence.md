# PR357 — inline review repairs

BASE87c370fa71760a91621bb7f5f8d3f759aace84a6. User requested both npm repairs,
explanation of dataField and compiler bytes, and a green PR. I9/ADR-0487/0488,
real Node24.16.0/npm11.17.0 are the authority; no new goal or narrowed promise.

## Fault matrix

Boundary: owned in-process request/result projection. Both defects originate
before/after the existing installer, not in delivery. Transport loss, duplication
and reordering are excluded by that row; network/OPFS remain existing owners.

| Fault / operation | Cause and carrier |
| --- | --- |
| false-fallback / named optional save | shared save required a lock version even after legitimate optional skip; absent version/range and failed tarball differential |
| lossy-aggregate / named update | shell discarded named-update intent, leaving installer an ordinary covering manifest/lock; same real npm sequence, retained-pin controls |
| sibling-drift / Eddy update | whole-tree Eddy request has no retained-pin update semantics; real Eddy initial install followed by selective named update |

Sweep: shared executeNpmInstallOperation serves COI and no-COI; root resolution
is installer-sources.createIncrementalSource, shared by required/optional roots.
Root optional metadata and acquisition failures meet installer-walk's existing
catch. Eddy fresh resolution remains usable; existing-lock updates use the same
incremental installer to preserve unrelated pins. No new coordinator/cache owner.

## Executed evidence

- Initial shared native suite:8 RED/2 controls GREEN; real Chromium:8 RED/2
  controls GREEN. No import/type failures. Logs
  /tmp/pr357-repair-red.log and /tmp/pr357-repair-browser-red.log.
- Shared native save/update/Eddy/command suite195/195 GREEN. Additional real
  HTTP500 tarball failure proves selected version remains available after the
  optional package fails acquisition. /tmp/pr357-repair-focused.log.
- Revert-check:10 RED/20 controls GREEN across the new sequence/fault and Eddy suites; source restored. /tmp/pr357-repair-revert.log.
- Native npm11.17's unresolved optional save is itself unusual: null package
  name alias (`npm:null@*`, bounded requested range retained). Tests compare
  actual native maps; no invented installed version or file. General npm aliases
  remain the existing explicitly unsupported input, including reuse of that
  native-produced alias. This repair does not introduce alias resolution.

## dataField

The actual baseline carrier is no-coi-sandbox-build-loop.spec.ts test
“package-generic bounded cause projection”, mode own-cause-gap: a genuine
NotImplementedError has a throwing own cause getter. Old serializer read it
while creating the Worker reply and never sent the terminal receipt. This is
an executed adversarial JS carrier, not a discovered third-party npm package.

A cause.name/message accessor is a separate unit fault case, not the original
observed trigger. Error.name is ordinarily inherited; DOMException name/message
are genuine native prototype getters, required for occupied receipts. Descriptor
inspection skips guest accessors while retaining those native getters. try/catch
can catch a thrown getter but cannot undo its side effects or interrupt a getter
that never returns. The depth8 bound separately terminates prototype walks of
Proxies inventing cyclic/unbounded ancestry; 8 is a diagnostic budget, not an
ECMAScript limit. It bounds traversal steps, not arbitrary Proxy trap execution.
No universal hostile-object sandbox is claimed. Five existing JS tests rerun
GREEN: /tmp/pr357-cause-current.log. No serializer change required by this audit.

## typescript-worker.js

Rebuilt the exact main45067718 and reviewed87c370fa7 source through the same
esbuild0.28.0 asset recipe using onLoad source overlays. Both hashes reproduced:

| Revision | Bytes | SHA256 |
| --- | ---: | --- |
| main45067718 | 10022694 | 8e175378ea88ad76f74ed3c01503ed16a94c0d53191066a972039117f3c13ba8 |
| PR87c370fa7 | 10022664 | ffeebf6f17b0783becec66cb7839e0cfeb299dfc70307fec06ecbec22ad0f357 |

Complete diff: static shared-chunk references/order, one fewer side-effect
import (30 bytes), dynamic module-loader filename. Compiler body is unchanged.
Shared runtime/VFS changes alter esbuild's split graph even though the TypeScript
entry source is unchanged. Retained raw diff: pr357-typescript-worker-delta.diff;
reproducer /tmp/pr357-compiler.mjs. No compiler upgrade or payload allowance.

Chromium14/14 GREEN:11 native npm cases, original package-generic bounded-cause
carrier, both occupied deadlines. /tmp/pr357-repair-browser-green.log.
Npm-client/Workbench typechecks, lint and build:libs pass. Rebuilt compiler remains
exactly10022664/ffeebf6f…; retirement gate verifies the unchanged PR pin.

First full pr:check26/27: test:run had2 failures in the catalog fault fixture,
0 timeouts; both reproduced in its automatic isolated rerun. Other lanes,
including parity, passed. /tmp/pr357-repair-pr-check.log.
PR-4 criterion inspection: that fixture admitted snapshot and tarball HTTP only;
new named intent reaches packument metadata before its intended catalog fault.
Native npm sequence ms@2.0.0 → ms@2.0.0 with the same test registry requests
/ms again (even though the selected version remains2.0.0). Added the genuine
vendored package manifest at that external HTTP boundary; catalog quota and
permission injection, mutation outcome and reload assertions are untouched.
Isolated post-change suite2/2 GREEN: /tmp/pr357-repair-catalog-green.log.

Second full gate on1b58f3595: test:run GREEN238.8s, all static/build lanes GREEN;
parity aborted natively with exit134. /tmp/pr357-repair-pr-check-final.log:

```
✓ worker_threads/handle-reference-api.case.ts
FATAL ERROR: v8::ToLocalChecked Empty MaybeLocal
node::cjs_lexer::Parse
cjsPreparseModuleExports (node:internal/modules/esm/translators:397:44)
```

Node24.16.0/macOS. Last printed PASS does not identify the crashing case.
Same-tree `pnpm test:parity worker_threads` passed all cases;
/tmp/pr357-repair-parity-worker-isolated.log. Prior full parity passed125.3s.
Cause unproven; no speculative runtime/test change. Question captured in
`docs/backlog/toolchain-build/parity-native-cjs-lexer-crash.md`; final independent
review also checks this factual capture. Full gate repeated once after isolation.
