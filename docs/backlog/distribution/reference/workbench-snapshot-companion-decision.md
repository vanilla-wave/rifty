# Independent I3 producer diagnosis

Read-only project; all own writes under /tmp. Node24.16.0, npm11.17.0.

## Verdict and evidence

Real goal-integration failure; not caused by the reconstructed fixture. Current
installer deliberately rejects this historical replay shape, so changing that
behavior needs an explicit partial supersession, not quiet test retargeting.
Required carrier: existing I3 preparation/PR316, because goal I1 + scenario1/3
require a real public Vite manifest/npm-lock producer. No new package scope.

Commands, both executed successfully (script captures expected producer errors):

- node_modules/.bin/tsx /tmp/rifty-316-i3-independent-probe/probe.mjs
- node_modules/.bin/tsx /tmp/rifty-316-i3-independent-probe/contrast.mjs
- pnpm exec vitest run packages/workbench/src/glue/dep-snapshot-producer.test.ts packages/npm-client/src/installer-shadow-shims.test.ts

Files: results.json, contrast.json, output.log, contrast.log, existing-tests.log;
rollup/package-lock.json, esbuild/package-lock.json, vite/package-lock.json are
unmodified real npm-authored v3 inputs. Both scripts retain exact commands.

| Probe | Result |
|---|---|
| ordinary npm rollup4.63.1 lock -> public producer | EBROKENLOCK missing-entry @rollup/wasm-node |
| ordinary npm vite7.3.6 + exact rollup4.63.1/esbuild0.28.0 lock -> public producer | same failure |
| same Vite lock -> native npm ci --ignore-scripts -> real vite build | exit0; 3modules; dist/assets/index-B0jHb3ze.js |
| ordinary npm esbuild0.28.0 lock -> public producer | archive7634221B, sha256:5b6b8c5e9016355db557f1d2a08e30bfb7b2a311699582465e8e4c792b2fd261 |
| no lock -> existing rifty install rollup4.63.1 | rollup4.63.1 + @types/estree1.0.9 + @rollup/wasm-node4.63.1 |
| actual preceding rifty lock with retained companion -> public producer | archive1416279B |
| current producer/shadow-shims tests | 36/36 PASS; existing pre-shim companion rejection included |

The parent fixture does serve an installed esbuild facade: package.json points
to lib/main.cjs, whereas original npm esbuild0.28.0 points to lib/main.js. Its
rollup/vite tarballs are repacked installed snapshots, not upstream tarball byte
identities. This matters for future acceptance honesty, but the unmodified
upstream/npm probes above discriminate and reproduce the same defect.

## Root trace

- Registry owner: tools/shadow-registry/src/index.ts:109 declares exactly one
  companion family, rollup -> @rollup/wasm-node, same trigger version.
- npm-client/shadow-shims.ts:74 derives that request.
- installer-walk.ts:473-520 passes the retained trigger's ordinary childContext
  to its injected companion request. parentOrigin is lockfile.
- installer-walk.ts:159-208 considers only override/recipe as policyFrontier.
  Rollup companion is internalsShims data, outside the exact recipe catalog.
- contrast.json records the real decision for @rollup/wasm-node4.63.1:
  missing-entry, policyFrontier:false, registryOwns:false. The identical request
  under metadata parent gives registryOwns:true. This is a probe, not a proposal
  to mislabel the parent.
- installer-sources.ts:98/118/172 therefore chooses strict locked.resolve and
  throws. No companion fetch is attempted. Native optional packages are
  correctly skipped with real npm input, unlike fixture coverage-gap warnings.
- Even making that resolution succeed would leave a second boundary refusal:
  dep-snapshot-producer.ts:86-111 permits only attested recipe materialization,
  acquisition and validated embedded children as new paths. Rollup companion
  has no such fact and would be refused as an ordinary new pin.

## Authority/DEC2

- Goal I1 + real Vite scenario require this composed route, within current scope.
- ADR0188 retains same-version Rollup companions, nested placement, replay
  derivation and loud drift. Its replay interpretation is explicit in
  installer-walk.ts:514 and installer-shadow-shims.test.ts:652: a pre-shim lock
  missing companion throws. Partially supersede that rejection for policy
  requests; keep missing ordinary child errors, version lockstep, range gates,
  real source integrity and installed-shim behavior.
- ADR0387 paragraph beginning 'Before emitting' restricts additions to attested
  recipes. Partially supersede only this list to include verified declared
  companion acquisition paths. Existing ordinary/existing acquisition pins
  still compare exact path/version/resolved/integrity; children get no blanket
  exception.
- ADR0023 retained-pin authority remains; distinguish absent policy-issued edge
  from absent recorded ordinary dependency. ADR0384 registry policy ownership
  and ADR0361 exact-recipe admission/trace authority remain unchanged.

Candidates for parent decision:

1. Preserve finite internalsShims declaration and represent policy-issued
   companion requests explicitly at the shared source-decision boundary; derive
   producer permission from installed, parent/path/version-scoped facts. Smallest
   interface; no new resolver, public knob or caller pin rewrite. Existing
   walk-up path helper is pinnedEntryForParent; use a shared authority, not bare
   companion-name/path substring trust. Preferred subject to Contract+RED.
2. Move Rollup to the exact substitution catalog. Current catalog matches exact
   trigger/acquisition versions, while Rollup supports ^4 and source version
   must equal each installed trigger. One pinned recipe narrows existing
   support; dynamic multi-version recipes add a new model/deeper scope. Not
   justified for this seam repair.
3. Producer installs from scratch then compares output pins. Simple interface,
   but discards valid retained transitive selection: metadata picks newer
   ordinary identities and strict postcondition refuses legitimate old npm
   locks. Not a faithful fix.
4. Caller manually pins wasm, producer synthesizes lock entries, or parentOrigin
   is changed to metadata: hides the lost policy origin / alters caller or source
   authority. Rejected by goal and pin fidelity.

## Class and sweep

Primary: sibling-drift at registry adaptation declaration -> installer source
choice -> producer output admission. Both native substitution mechanisms carry
policy-issued packages, but only catalog recipes retain that distinction.
There is no root-cause network fault: original fetch/SRI and native Node build
pass. Fixture-only acceptance was a frozen-assumption risk, now discriminated.
Fault taxonomy has no in-process policy/graph row; add that missing boundary
model if fault-matrix rules require a concrete row. Direct calls have no
transport loss/replay/reorder; retain malformed/provenance/path projection and
observable-error-order axes. Fetch and archive storage remain their own rows.

Reachable siblings requiring one shared decision/admission authority:

- installer-walk.ts companion visit on retained root AND nested trigger;
- installer-sources.ts incremental metadata-vs-replay choice;
- eddy-fast-path.ts:526-585 no-I/O mirror: same companion/current-origin shape,
  same lost policy distinction, currently classifies it broken. Class-kill
  applies; ensure shared source decision, no independent second exception;
- producer output admission: classify only actual declared companion paths;
- installer-bin-claims.ts:151 uses companionRequestsFor + parent-scoped lookup;
  preserve companion-only bin suppression and ordinary-demand upgrade (ADR0343);
- applyInternalsShims installed version checks and replay accounting must remain
  valid for each nested trigger; current public fixture covers one flat version;
- esbuild/lightningcss catalog peers: esbuild real npm positive proven above;
  producer's existing retained lightningcss acquisition-pin mutation test passes.
  No second declared companion family exists.

## Required RED before implementation

1. Actual npm-authored rollup4.63.1 lock + real registry tarballs: public producer
   expected success, inspect same-version WASM package and native shim; compare
   every retained ordinary path's version/resolved/integrity. Currently red.
2. Same ordinary Vite lock -> packed public producer -> snapshot-only browser
   dev/build/preview, zero registry/Eddy during restore/runtime. Native Node build
   baseline above; do not use prepatched esbuild/rollup fixture source as oracle.
3. Retained valid companion pin unchanged; retained conflicting same-name pin
   must be preserved at its actual path. A nested trigger/root-version conflict
   exercises scoped resolution/addition, not package-name permission. Existing
   installer-shim nested tests show this model is reachable.
4. Missing ordinary parent dependency and newly resolved ordinary child of the
   companion remain rejected by producer; exception authorizes only companion,
   never its arbitrary metadata closure. Retained ordinary or companion source
   identity drift rejects; malformed/unfetchable/corrupt companion fails loudly.
5. Eddy analysis must agree with mixed source decision for the same companion
   frontier. Existing missing ordinary replay tests and esbuild/lightningcss
   recipe authority tests remain green.

No tracked production/test/doc edits made by this diagnosis agent. Parent's
concurrent tracked changes were observed and left untouched.
