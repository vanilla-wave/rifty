# I3 pickup research — read-only, 2026-09-08

Scope: independent DEC-4/DEC-2 research; no tracked edits, tests, ADR or implementation. Read current I8 worktree, original goal/map/draft/raw answers, ADR-0263/0278/0394, actual owners and packed carriers. Observations below are source-derived, not executed behavioral proof.

## Authority / scope

- Goal I3 + scenario2/4: explicit snapshot-only, no registry URL/client, zero registry/Eddy acquisition, required invalid snapshot rejects before guest startup. Registry-enabled acquisition remains.
- I8 + user rounds2/3: saved open first proves saved trust; a changed unused asset is neither fetched nor validated. Apply always evaluates incoming payload; catalog owns generic file conflicts. A missing stamp is NOT initial admission.
- Draft says available exact-byte replay **may** work. This permits reuse of existing local installer paths; does not require a second offline installer or promise npm CLI --offline parity.
- Goal excludes general guest-network isolation, no-COI SDK changes, producer authentication policy. Producer still legitimately uses a configured registry in CI. Do not treat those as browser acquisition leaks.
- No new user-value fork identified. API spellings and whether to retain the already-implemented exact-byte replay path are route choices. Do not re-ask accepted scope.

## Public shape alternatives

A. Recommended compatible explicit union:

```ts
type WorkbenchPackageAcquisition =
  | { readonly mode?: 'registry'; readonly registryUrl: string; readonly eddy?: ExistingEddy }
  | { readonly mode: 'snapshot-only'; readonly registryUrl?: never; readonly eddy?: never };
```

Old `{registryUrl, eddy?}` continues unchanged. Normalize once to explicit `mode:'registry'|'snapshot-only'`; owner wire carries that exact closed union. Snapshot-only rejects supplied registryUrl/Eddy, unknown mode and malformed shape before owner effects. No root snapshotUrl; descriptors remain definition-owned. No URL/default lookup or RegistryClient constructor in snapshot-only branch.

B. Absence switch: `{registryUrl?: string; eddy?: ExistingEddy}` and absent URL means snapshot-only. Fewer characters, but omission silently changes previously invalid configuration into a successful policy choice; Eddy-without-registry must be separately explained. A wins because user explicitly selects acquisition mode, while old callers retain validation/defaults.

C. New top-level `offline` flag plus existing required acquisition object: fails no-dummy-URL and makes contradictory flag/URL states; avoid.

## Existing-owner implementation route

1. `workbench/internal/workbench-options.ts`: public union + one normalized acquisition value; only registry branch resolves URL/Eddy defaults. Existing retired snapshotUrl rejection remains. `PlaygroundWorkbenchOptions` derives same root options.
2. `workbench/workbench-owner-port.ts` and `workbench/owner-protocol.ts`: replace duplicated acquisition structs with the normalized union or a shared internal type; exact branch-specific owner validation. `workbench-browser-owner.ts` already forwards `input.packageAcquisition` into config; do not make another policy parser.
3. `workers/workbench-owner-runtime.ts:288-314`: conditional registry construction, no call to `createProxiedRegistryClient`/`getRegistryBaseUrl` when snapshot-only. Pass real absent registry and normalized mode into `createOwnerPackageState`; Eddy callbacks never configure/prime a request in that branch.
4. `workers/owner-package-types.ts`, `owner-package-state.ts`: real optional registry capability; same config map, package FIFO, stamp authority, snapshot planner/restore and child-admission APIs. No replacement install adapter/client.
5. `workers/package-acquisition-types.ts`/`package-acquisition-authority.ts`: owner acquisition policy is authoritative for automatic paths. `#firstMaterializationDecision` returns trusted/snapshot readiness, but in snapshot-only must rethrow snapshot-unavailable and reject an install decision instead of constructing deferred install. `#ensure` must force snapshot-only semantics before demote/prepare when no verified snapshot and registry-disabled, even if a caller passed fallback:'install'; direct `activate-and-ensure` currently hardcodes install. Preserve saved/apply/initial receipt branches from I8, including rollback on throw. Do not decide file conflicts here.
6. `workbench/errors.ts` currently serializes only name/message (plus conflict paths). `PackageAcquisitionError` stores snapshotFailures privately while its message only says 'verified snapshot unavailable'. I3 requires the reason to reach the public host: minimal solution includes concrete snapshot failure reason(s) in error.message; no new public structured error API is required by scope. Test across owner boundary, not only local error fields.

### Registry-free npm operation: two honest routes

Preferred: preserve existing local install/replay algorithm by making `InstallOptions.registry` optional (absent = network acquisition unavailable), and guard the two actual network dereferences. This adds no new replay algorithm, claim authority or coordinator, and keeps meaningful local functionality.

- `npm-client/src/installer-request.ts:isInstallOptions` currently requires truthy registry, so one-/three-argument public calls without it misclassify before real install. Update overload discrimination to actual options fields; check all three overloads.
- `npm-client/src/installer.ts:291-294`: lazy tarball callback throws NotImplementedError for unavailable registry only on a cache miss. Never construct a denying/dummy RegistryClient.
- `npm-client/src/installer-sources.ts:340-350`: lazy packument lookup does the same after real caller cache lookup. Lockfile source, synthetic shadow recipes, cached tarballs stay unchanged.
- `installer.ts` Eddy branch + direct-input normalization: reject contradictory absent-registry + configured resolver before dispatch; absent registry never consults Eddy/prefetch/pin callbacks. Scope does not introduce Eddy-only acquisition.
- `workbench/glue/npm-shell-command.ts:NpmShellCommandDeps` can pass absent registry into the real installer. Owner automatic paths remain disabled; explicitly requested terminal `npm install` can reuse available exact bytes, and missing required metadata/tarballs report unsupported acquisition without egress. Existing install mutation/rollback/trust behavior stays with its owners; do not invent an atomic-install promise.
- `NotImplementedError` is an honest missing capability; no invented Node oracle for the mode. Preserve baseline optional-dependency warning/skip policy rather than introducing a global failure rule without authority.

Smaller owner-only alternative: reject every install command/direct install operation in snapshot-only, before demotion/preparation, and make registry optional only in local shell deps. This meets zero-egress but unnecessarily blocks existing empty-graph/cached replay. Draft permits, not requires, replay, so this is an internal tradeoff; if selected, document limitation, keep npm run/local script APIs working, and do not misleadingly claim all registry-independent npm behavior remains. A stub RegistryClient is not an alternative.

## Complete reachable construction/use inventory

| Owner/path | Present behavior | I3 handling |
|---|---|---|
| Public openWorkbench/openPlaygroundWorkbench → options → worker | registry required at all 3 type/validation seams; unconditional client constructor | explicit union, no client in snapshot-only |
| Companion fresh snapshot → `#firstMaterializationDecision` | snapshot failure swallowed into deferred `kind:'install'` | preserve reason, throw, pending catalog receipt restored |
| Companion install plan → same decision | trusted tree returns ready; otherwise deferred install | allow real trusted reuse; reject required automatic install |
| Companion run → `project-runtime-acquisition.ts` | deferred plan generates `npm install && runtime` | no install plan can be emitted in snapshot-only |
| Core openProject → materializer → `activateAndEnsure` → `activate-and-ensure` | hardcoded fallback install | same policy check, no public core bypass |
| Direct authority `ensure` / activate / prepare-first-materialization | caller fallback can request install | owner mode wins; trusted reuse and verified snapshot stay local |
| Owner restore/transition → `ensureProjectDependencies` | restore-only unavailable becomes `{source:'none'}` + warning | unused by current public owner boot (no caller outside owner-state); cannot adopt as public snapshot failure carrier; if strict mode calls it, must rethrow rather than soften failure |
| Terminal npm install/i/add incl --prefix, nearest-package cwd, nested script invocation | same FIFO → owner adapter → executeNpmInstallOperation → npm-client.install | real local replay or explicit unsupported acquisition; no terminal-only check |
| Direct `executeNpmInstallOperation` / `createNpmShellCommand` | only production caller is owner-state; internal exports | optional registry remains honest through operation; no fake install success |
| npm-client install (all overloads) | lockfile/cached metadata + tarball cache; misses call registry | lazy unavailable errors; default registry-enabled callers unchanged |
| Eddy owner prefetch | `configure`/initial priming → primePrefetch → decide/startInstallPrefetch | no resolver configured/primed in snapshot-only |
| Eddy install/learned pins | resolver fast path; pin reads/writes/background revalidate | exclude whole capability; zero delayed/background requests |
| Producer `dep-snapshot-producer.ts:151` | creates proxied client in CI | retained, outside browser mode |
| No-COI `no-coi-toolchain-install.ts:18` | explicit per-install registry client | excluded by accepted map; unchanged |
| Shell npx/yarn/pnpm/bun | existing unavailable diagnostics; no auto-installer | preserve, no hidden acquisition path |
| Guest application fetch/network or caller-created standalone RegistryClient | independently explicit caller behavior | outside Workbench acquisition isolation |

Local capabilities to preserve: snapshot restore/application; trusted saved reopen; project files/documents; catalog/SCM/archive/TS; terminal cwd/env and ordinary shell operations; installed bins; node scripts; `npm run`/`run-script`, pre/main/post lifecycle scripts and test/start/stop/restart aliases, --prefix/nearest-prefix behavior, npm help. No registry is read by these command branches. Scripts that themselves invoke npm install return through same owner. Child package-tree admission remains the real trust gate; missing bytes never cause child-spawn auto-install.

## RED/public proof carriers

No tests run here. Contract+RED must run these against the agreed shape, with real owners/VFS/producer and only external network/storage fault boundaries.

1. `open-workbench.test.ts` + owner-protocol tests: snapshot-only without URL accepted (baseline RED missing URL), closed wire branch, invalid modes/conflicting fields rejected before claim/Worker; legacy registry/default normalization unchanged. Packed TS fixture consumes actual public type without cast/dummy URL.
2. Real owner-state + catalog fixture (`workers/test-fixtures/snapshot-saved-state.ts`, I8 contracts): produced valid archive → ready; missing/HTTP refusal, wrong hash/template/artifact identity, corrupt/replay-incomplete/over-limit body → loud reason, zero install/registry/Eddy, no guest admission, pending receipt/prestate recovered. Reuse I8 transaction/fault carriers rather than new coordinator.
3. Direct core/open + direct authority paths: a registry-required definition/caller fallback:'install' cannot escape; trusted existing tree can reuse. Companion install plan requiring install fails before session/runtime. Keep registry-enabled deferred fallback positive control.
4. Terminal: installed local npm run/build/dev; aliases, prefix/nested script path; required new package, missing cached required tarball, changed uncovered dependency, `--prefer-online` cannot perform requests. If choosing local replay route, warm actual lock/cache via real install or producer, invoke real npm-client with no registry through all public overloads, assert exact installed bytes/provenance; clear/corrupt one cache entry and require useful unavailable error. No denying RegistryClient subclass as product seam.
5. Public owner error round-trip: distinguish unavailable fetch, hash mismatch, replay rejection using received message; check no runtime sentinel executed. Local snapshotFailures assertions alone miss current reason loss.
6. I8 composition: persistent snapshot-only close/reopen with edited saved project + changed descriptor pointing to hostile/unavailable asset; no asset request, bytes/real execution preserved. Invalid saved trust fails without restoration/network. Explicit apply of that same unavailable asset fails and preserves saved state.
7. Packed acceptance: extend existing `workbench-vite-consumer` + `workbench-packed-consumer.mjs` mandatory Chromium lane. Current producer fixture only proves ms@2.0.0; current Vite build/dev path is registry-backed. I3 needs **producer-produced Vite** tar.gz + copied asset closure + real `npm run build` and dev/preview in snapshot-only, no URL. Reuse fixture registry's real tarballs/lock production; add Vite producer input, not handmade installed tree.
8. Hostile network proof: after producer's Node phase, server-side registry/Eddy counters reject every browser acquisition attempt; browser request observer catches accidental/default endpoints too. Existing context route allows both preview and registry origins and is insufficient alone for strict deny. Observe same-origin `/npm-registry` as well as direct registry origin; Service Worker requests need server-side counters (route interception alone is not a proof). Keep static/snapshot URLs allowed. Assert zero during fresh restore, npm failure, reopen, dev stop/settlement; existing registry-enabled journey still succeeds as positive control.

Production faults: reuse I8 initial/apply catalog rollback and real OPFS crash/reopen; add strict-policy rejection at the fresh receipt boundary, required snapshot network refusal/stall/corruption, missing/corrupt cache, and sibling direct/terminal denial. No duplicate/lost MessagePort-delivery model, no new timing or size promise.

## ADR updates

- New short distribution ADR (DEC-1/2) records public union, lower absent-registry capability if chosen, automatic vs explicit local acquisition, errors, alternatives and current source evidence. This research can supply the independent DEC-2 input; it is not a checkpoint verdict.
- ADR-0263 **must** receive scoped active correction: Generic vocabulary 'required registryUrl; no mode/kind' and Configuration 'registry always correctness fallback' become registry-enabled branch claims. This is the primary earlier API authority, easy to miss if reading only 0278.
- ADR-0278 scoped correction: first-materialization miss/deferred install and visible fallback are conditional on registry-enabled; other catalog/terminal policy remains. ADR-0394 already corrects saved/open/application behavior.
- ADR-0394 decision3 explicitly says existing **registry-enabled** deferred outcome, so no overturn needed there. Cite it as preserved authority; clarify successor composes I3 without changing receipt/application/rollback policy.
- If widening npm-client InstallOptions: cite ADR-0023 and ADR-0182. Their network-miss/fallback promises remain for configured registry; absent capability throws. Correct only wording claiming unconditional network availability if needed; do not rewrite existing resolution/optional policy.
- Workbench README/public compat matrix + affected package CHANGELOGs; no fabricated Node --offline compatibility claim.
