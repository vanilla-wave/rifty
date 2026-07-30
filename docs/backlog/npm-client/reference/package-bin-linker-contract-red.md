# Terminal package-bin linker Contract+RED

Recorded 2026-07-28 on the fresh split successor to terminal predecessor
`npm-client/shadow-materialized-bin-authority@9967b5093c4aa6a8dfdf7f35f77a7e8b802a8a97`.
No production source differs from `origin/main`. Shadow recipe integration,
aliases, shims, lock publication, and reporting are absent from this unit.

## Executable RED

```sh
pnpm vitest run \
  packages/npm-client/src/linker-bin-authority.contract.test.ts
```

Initial checkpoint
`83ea4bf28e880eaf6c581de69731548860c318a5`: 18 tests, 16 RED and 2 GREEN.
Contract+RED review blocked the missing detached-claim, current-target,
install-path ingress, and single-composer proofs.

Final re-cut result at
`8e1456665a3d7a77425b5afa8f0c802ac59162b5`: 28 tests, 24 RED and 4 GREEN.

- opposite current input orders in root and nested scopes write plausible
  launchers instead of rejecting
  `NotImplementedError('npm-client.bin-collision-reify')` before VFS mutation;
- public `link()` interleaves the first package launcher before later package
  files instead of settling all package files first;
- the package-private file phase, normalized-claim bin phase, and current/prior
  preflight seams do not exist;
- the finite topology and detached-claim sentinels reject a duplicate or unused
  phased writer; root/string and nested/object cases require one normalization
  and one target read / launcher write through public, install-tree, and phased
  entrypoints;
- prior-owner transition, removal, and recorded-prior-collision cases
  therefore have no generic loud boundary; a stable prior owner cannot yet
  return and link only the current target;
- absolute and traversal install paths retaining the expected package suffix
  reach VFS mutation through public and install-tree entrypoints, while the
  missing preflight and package-file phases cannot reject them;
- escaping bin targets reject only after project-tree mutation;
- root/nested target-read abort and launcher `ENOSPC` / `EACCES` retry tables
  remain RED until they can enter the missing shared bin phase.

The four GREEN cases retain honest behavior: the same command in independent
root and nested scopes produces two exact launchers; existing public and
install-tree paths each make exactly one target read and launcher write per
non-colliding claim; and a missing target stays loud without writing its
launcher.

The second isolated Contract+RED review blocked one remaining
`corrupt-input` gap: safe-relative `packages/bad-cli` did not prove rejection
with and without bin metadata across every raw linker and installer/lockfile
sibling. Per review convergence this unit is terminal and receives no third
checkpoint. Its RED allocation is:

- `npm-client/resolved-package-install-path-authority`: exact raw path grammar,
  prepared carrier, existing public linker/lockfile/installer ingresses;
- `npm-client/package-bin-claim-linker-authority`: current/prior claim
  settlement, new file/bin phases, detached launcher writer, and consumption of
  only prepared packages.

## Sibling gates

```sh
pnpm vitest run packages/npm-client/src/linker.test.ts
pnpm vitest run packages/npm-client/src/installer.test.ts
pnpm check:runtime-adapter-boundary
pnpm backlog:check
```

The inherited linker suite remains the regression floor. The runtime boundary
gate keeps package-specific shadow names and branches out of the generic
linker. The installer suite keeps its independent ADR-0261 ingress safety
green, including a resolved scoped-name traversal rejected before project-tree
mutation. The serial shadow commit successor must separately prove that real
recipe claims use these phases; this generic unit does not infer integration
from a source grep.

## Prepared-path successor baseline

Recorded on post-#215 main
`5d419b46fe4258ddac55d4a87bccbdff622e13af`, Node 24.16.0 and npm
11.17.0. PR #215 settled a two-level topology: raw linker entrypoints prepare
paths once, while real install reuses the same prepared carrier across targets,
linking, and lock construction. The successor contract therefore places one
shared bin-preflight/files/bins behavior after that boundary. Authoritative
prior is a narrow `(package.name/bin, nodeModulesDir)` source; it never
fabricates package files.

The packed npm oracle reproduced byte-for-byte:

```sh
node docs/backlog/npm-client/reference/npm-11-bin-collision-probe.mjs \
  | cmp - docs/backlog/npm-client/reference/npm-11-bin-collision-probe-output.json
```

The complete inherited path/linker/installer floor remained 115/115 green:

```sh
pnpm vitest run \
  packages/npm-client/src/linker-resolved-package-path-authority.contract.test.ts \
  packages/npm-client/src/installer-prepared-path-consumption.contract.test.ts \
  packages/npm-client/src/linker.test.ts \
  packages/npm-client/src/installer.test.ts
```

The first fresh successor carrier ran 20 allocated tests: 16 RED and 4 GREEN.

- RED: four current-collision orders, files-before-bins, the finite prepared
  topology, direct phased use, root/nested abort, `ENOSPC` / `EACCES`, three
  authoritative-prior transitions, stable-owner current-target replay, and
  escaping-target zero-effect rejection.
- GREEN: independent root/nested scopes, non-colliding public and cancellable
  raw entrypoints, and missing-target repair/retry.

```sh
pnpm vitest run \
  packages/npm-client/src/linker-bin-authority.contract.test.ts
```

No product, compat, changelog, installer-test, or raw-path-contract change was
present in this checkpoint.

## First successor review blocker and re-cut

Contract+RED review at
`e39bb917bfbbe9ef4a5e6c034e54637a9a8a25ed` blocked:

- a forbidden AST/source-inspection topology test;
- single-claim abort rows that could not detect later work;
- erased phase types that could admit raw packages;
- uncounted authoritative-prior bin reads;
- no executable guard for the required public compat ❌ row.

The in-place re-cut removes all product-source parsing. Equivalent operation
ledgers now cover public, cancellable, already-prepared, and direct phased
paths; a compile-time RED rejects raw packages at all three phase ingresses;
root/nested abort parks the first of two claims and forbids the second read;
both string/object prior sources throw on a second read. The hand-maintained
public table now carries an honest RED note: current tree-order settlement is
untrusted and the named ceiling is required before mutation.

The second combined carrier at
`30416e72eea35cd992ef87f62b951d6c70eb45fb` runs 20 tests: 15 RED and 5
GREEN. Package-local typecheck adds three intentional `TS2578` REDs while the
three phase exports are absent.

## Second successor review blocker and terminal split

The second isolated Contract+RED review at
`30416e72eea35cd992ef87f62b951d6c70eb45fb` blocked again. Exact review
blocker summaries:

- first @ `e39bb917bfbbe9ef4a5e6c034e54637a9a8a25ed`: forbidden source
  inspection, incomplete abort/narrow/prior/compat;
- second @ `30416e72eea35cd992ef87f62b951d6c70eb45fb`: prepared ordering
  false-green, missing positive narrow type proof, unguarded compat row,
  final-state-only zero-mutation proof.

Per review convergence, `npm-client/package-bin-claim-linker-authority` is a
terminal blocked split predecessor and receives no third checkpoint. Its
lineage is
`[e39bb917bfbbe9ef4a5e6c034e54637a9a8a25ed,
30416e72eea35cd992ef87f62b951d6c70eb45fb]`.

The new carrier allocation is:

- `npm-client/package-bin-claim-preflight-authority`: normalize current/prior
  once; prove narrow positive and negative types; keep root/nested scopes
  independent; reject current/prior ambiguity and escaping targets before any
  mutating VFS call; guard the exact structured compat ❌ row;
- `npm-client/package-bin-phased-linker-authority`: prove all files before one
  detached bin pass across public, cancellable, and prepared paths; prove the
  sole launcher writer behaviorally; keep target existence, first-of-two
  abort/later-work, `ENOSPC`, `EACCES`, and exact retry loud.

Only the claim-preflight unit is the current epic Items/Budget selection. The
phased unit remains a linked draft behind it. Each successor re-cuts its own
Contract+RED carrier; the combined test carrier remains terminal checkpoint
evidence.

The first fresh claim-preflight carrier runs 16 tests: 11 RED and 5 GREEN.
Package-local typecheck adds exactly two intentional `TS2578` REDs while the
narrow preflight export is absent; after implementation they go green only if
raw `ResolvedPackage` and shaped output claims are both rejected at source
ingress. Positive prepared-current and narrow current/prior calls compile
against the actual conditional export.

Its first isolated review at
`6fdc19c5b98b9773fa5406126e6ac35c4329b9af` blocked an append-only Budget
violation plus three false-green gaps: current collision and escaping-target
ledgers covered only public `link()`, authoritative prior had no
prepared-entry integration, and rejecting branches did not count source reads.
The in-place re-cut restores the predecessor Budget row, exercises public,
cancellable, and prepared current/target paths, adds the OPTIONAL narrow-prior
prepared carrier required by the later installer successor, and makes every
rejecting current/prior bin source throw on a second read. It runs 17 tests:
12 RED and 5 GREEN; package typecheck carries the same two intentional
`TS2578` REDs plus one `TS2554` RED until the prepared path types its optional
prior carrier.

## Claim-preflight second blocker and terminal split

The second isolated claim-preflight Contract+RED review at
`cbeb4bfe04f270898aa003c04ef8e6edd3daf280` blocked again. Exact review
blocker summaries:

- first @ `6fdc19c5b98b9773fa5406126e6ac35c4329b9af`: append-only Budget +
  entrypoint/prior/read-count gaps;
- second @ `cbeb4bfe04f270898aa003c04ef8e6edd3daf280`: optional prepared prior
  negative type proved raw but not shaped `PackageBinClaim`, permitting a
  broadened union.

Per review convergence, `npm-client/package-bin-claim-preflight-authority` is a
terminal blocked split predecessor and receives no third checkpoint. Its
lineage is
`[6fdc19c5b98b9773fa5406126e6ac35c4329b9af,
cbeb4bfe04f270898aa003c04ef8e6edd3daf280]`.

The anticipated successor carrier allocation is:

- `npm-client/package-bin-claim-normalization-authority`: pure
  package-private source/claim types and one real preflight; positive
  prepared/narrow sources; negative raw/claim sources; success and reached-error
  read counts; current/prior collision, transition, removal, stable target,
  independent scopes, escaping target, and exact named ceiling;
- `npm-client/package-bin-claim-link-ingress-authority`: public, cancellable,
  and prepared zero-mutation integration; optional prepared-prior positive plus
  raw/claim negative type witnesses; exact structured compat ❌ and the
  non-colliding floor.

The phased-linker successor now waits on link ingress and retains all
files-before-bins, target, abort/later-work, launcher-fault, and retry proof.
Only normalization is the current epic Items selection. Historical Budget rows
remain append-only and normalization appends its own `100–200` row; link ingress
receives no selected row yet.

The fresh normalization carrier runs 13 tests: 12 RED and 1 GREEN.
Package-local typecheck adds exactly two intentional `TS2578` REDs while the
real normalization export is absent; after implementation they go green only
if raw `ResolvedPackage` and shaped `PackageBinClaim` both remain rejected.

Its first isolated review at
`880813bf62a85050be44c48694e6560164b5f158` passed Standards and blocked three
Spec false-greens: rejecting paths covered only object-form bins, object
success never proved more than one command, and authoritative prior scope
independence used different commands. The in-place final re-cut adds
string/object rejecting witnesses, an exact two-command claim set, and equal
current/prior commands in independent root/nested scopes. The result is 24
tests: 23 RED and 1 GREEN, with the same two intentional `TS2578` REDs. It adds
no VFS, entrypoint, compat, or production-source scope.

## Normalization second blocker and terminal split

The second isolated normalization Contract+RED review at
`acf363bc6f34b7b070e787fad6619d99c3839723` blocked again. Exact blocker
summaries:

- first @ `880813bf62a85050be44c48694e6560164b5f158`: string-form rejects,
  multi-command exactness, and equal-command prior scope isolation;
- second @ `acf363bc6f34b7b070e787fad6619d99c3839723`: current-only negative
  type witnesses could admit broadened prior sources; equal-owner root/nested
  prior claims could admit a global command index.

Per review convergence,
`npm-client/package-bin-claim-normalization-authority` is a terminal blocked
split predecessor and receives no third checkpoint. Its lineage is
`[880813bf62a85050be44c48694e6560164b5f158,
acf363bc6f34b7b070e787fad6619d99c3839723]`.

The successor allocation is:

- `npm-client/package-bin-source-normalization-authority`: one strict source
  list becomes ordered detached claims without settling duplicates;
  prepared/narrow positive and raw/claim negative types; string/object,
  multi-command, once-read, and escaping-target proof;
- `npm-client/package-bin-claim-settlement-authority`: exact current/prior
  source lists compose that normalizer and settle by scope plus command;
  current/prior ambiguity, stable target, both-argument type witnesses, and
  distinct-owner equal-command scope proof.

The real optional-prior source type remains in the later link-ingress unit,
which composes both pure seams before VFS mutation. Only source normalization is
the current epic Items selection. Historical Budget rows remain append-only
and the new unit appends `50–120`; claim settlement receives no selected row
yet.

The fresh source-normalization carrier runs 7 tests: 6 RED and 1 GREEN.
Package-local typecheck has exactly two intentional `TS2578` REDs while the
strict package-private export is absent. The carrier returns every
prepared/narrow string/object claim in order, including duplicates; exact
escaping-target failures are counted once. It contains no current/prior,
ceiling, VFS, entrypoint, compat, or production-source work.

Its first isolated review at
`3c4adade0ae34b076e536147f5d551e82b737055` passed Standards and blocked four
Spec false-greens: separate singleton types did not prove one mixed readonly
list, all order fixtures were comparator-sorted, target errors used substring
matching, and rejection never reached a later invalid object command after an
earlier source. The in-place final re-cut adds the exact mixed readonly call,
anti-sorted source/command/owner order, exact message equality, and a valid
prefix plus later-invalid multi-command object with once-read counters. It
adds no settlement, VFS, entrypoint, compat, or production-source scope.

## Source normalization second blocker and terminal split

The second isolated source-normalization Contract+RED review at
`2ef0ecf61adb35fade0977cd0d0355be2a975ea5` blocked again. Exact blocker
summaries:

- first @ `3c4adade0ae34b076e536147f5d551e82b737055`: mixed readonly
  admission, anti-sorted order, exact error identity, and later-invalid
  reached-source reads;
- second @ `2ef0ecf61adb35fade0977cd0d0355be2a975ea5`: both two-element order
  witnesses still matched one descending tuple comparator.

Per review convergence,
`npm-client/package-bin-source-normalization-authority` is a terminal blocked
split predecessor and receives no third checkpoint. Its lineage is
`[3c4adade0ae34b076e536147f5d551e82b737055,
2ef0ecf61adb35fade0977cd0d0355be2a975ea5]`.

The successor allocation is:

- `npm-client/package-bin-source-claim-authority`: one strict source becomes
  exact claims; three-command non-monotonic order, prepared/narrow types,
  string/object once-read, and later-invalid target proof;
- `npm-client/package-bin-claim-aggregation-authority`: readonly mixed lists
  compose the single-source seam; three-source non-monotonic order, duplicates,
  and later-source errors remain exact.

Claim settlement starts only after aggregation. Only source claim is the
current epic Items selection. Historical Budget rows remain append-only and
the new unit appends `30–80`; aggregation receives no selected row yet.

The fresh source-claim carrier runs 7 tests: 6 RED and 1 GREEN. Package-local
typecheck has exactly two intentional `TS2578` REDs while the strict
single-source export is absent. A prepared three-command non-monotonic object,
a narrow nested scoped string, and exact later-invalid string/object targets
prove one-source behavior without list, settlement, VFS, entrypoint, compat, or
production-source scope.

Its first isolated review at
`b0c2e20613ec002db35a4dc5b220024f5117131a` blocked two gaps: command
reordering was misclassified as `lossy-aggregate` instead of
`observable-order`, and the real conditional export did not reject a source
list or second source argument. The in-place final re-cut corrects the fault
row and adds both negative witnesses. Package-local typecheck now has exactly
four intentional `TS2578` REDs while the strict single-source export is absent.
The second isolated review at
`3b9bdb57b2c8cdb544133c129e4ba68f1893de67` passed Standards and Spec with no
findings; this is the ready Contract+RED authority for implementation.

The no-pickup contract baseline keeps the executable RED in checkpoint history
instead of leaving main red. The source slice must restore exact blob
`808d8e7aacb4fd0feea80575cd1957f37fb42066` before its first production-source
commit; the ready verdict and carrier bytes may not change.

## Claim aggregation successor baseline

Recorded on post-#223 main
`782b1878f39efdd04e3a4ef623840c425b165f9b`, Node 24.16.0 and pnpm
11.5.2. The fresh aggregation carrier composes only the landed single-source
seam. It covers one readonly prepared/narrow list, an empty list, three-source
and per-source non-monotonic order, same-scope duplicates, exact later-source
string/object failures, once-read reached sources, and an unread suffix.

```sh
pnpm vitest run \
  packages/npm-client/src/linker-bin-claim-aggregation.contract.test.ts
pnpm --filter @riftydev/npm-client typecheck
```

No production source, package root, VFS path, settlement, compat, or changelog
diff is present at this checkpoint. Runtime result: 6 tests, 5 RED and 1 GREEN;
package typecheck adds exactly two intentional `TS2578` REDs while
`normalizePackageBinSources` is absent.

The first isolated Contract+RED review at
`2a51987dfc5488c7d07c86f6fc7c4a2c2839db5f` passed Standards and blocked
Spec: local redeclared shapes plus root-only sources could false-green a
duplicated parser that drifted from the landed nested scoped-string behavior;
the live epic also lacked this now-unblocked unit's pre-pickup Items/Budget
authority. The in-place re-cut imports the landed types, adds a nested scoped
string to the three-source witness, and appends exactly one Items mapping plus
one `20–60` Budget row. The RED ledger and production-source absence are
unchanged.

The second isolated checkpoint at
`d1a6ab025a8160305f18e86dc132e3466e988106` passed Spec and blocked Standards:
the 215-line carrier was far above the `20–60` slice band. Per Contract
escalation, the in-place re-refinement keeps the one deep in-process seam but
replaces repeated fixture/scenario scaffolding with four vertical interface
tests: private root, empty identity, one exact mixed order/duplicate witness,
and one exact later-error table. No behavior, Budget row, or production source
changes. The compact carrier is 119 lines, below the `2×` high-band re-cut
threshold; runtime is 4 tests, 3 RED and 1 GREEN, with the same two intentional
`TS2578` REDs.

The re-refined checkpoint still blocked: 119 lines remained disproportionate,
and its type proof could admit a tuple-only export while runtime narrow
fixtures still carried full resolved-package fields. The next in-place carrier
assigns the live conditional export to the exact list-wide type, calls empty
and three-source shapes at compile time, uses a genuinely minimal nested
scoped-string source at runtime, and folds the four behaviors into one vertical
interface test.

The split carrier is 88 lines: 65 runtime and 23 compile-only. Vitest has one
intentional RED; package typecheck has exactly two intentional `TS2578` REDs.
Production source remains untouched.

The isolated review at
`29c4aafb290bd643c42ca60eadafb31a1c3b3870` passed Standards and blocked
Spec: exact one-argument assignment alone could admit an optional second source
list, leaking prior/settlement surface. The final in-place carrier adds that
negative witness. It is 90 lines total; the RED ledger and production-source
absence are unchanged.

The next isolated review at
`4931ee371626fad3f550a037d2d2a2f071f737d7` passed Standards and blocked
Spec: a singular-source overload could still satisfy every witness. The
in-place carrier rejects both singular and absent source-list calls, completing
the exact-one-list boundary. It is 94 lines total; the same RED ledger remains.

The isolated review at
`d7018e92be95121d3a94f57192371753cd83b560` passed Standards and blocked
Spec: prepared-only singular and second-list overloads could evade narrow-only
negatives. The final in-place carrier adds both prepared witnesses and proves
the live export type equals the exact normalizer type, closing the overload
class rather than enumerating it. It is 106 lines total; RED and production
scope remain unchanged.

The isolated Contract+RED review at
`c00a91638a55699aeffa74f65959973ab8c22a20` passed Standards and Spec with no
findings. This checkpoint is the ready authority for implementation.

## Claim settlement successor baseline

Recorded on post-#231 main
`207e0ee9f108d6457e2448c956b84c2758e62671`, Node 24.16.0 and pnpm
11.5.2. The fresh settlement carrier composes the landed aggregation seam for
exact current and optional-prior source lists. It covers exact positive and
negative types in both argument positions, opposite current collision orders
in root/nested scopes, prior collision/owner transition/removal, stable-owner
target change, current-only addition, and equal commands with distinct matching
owners in independent scopes.

```sh
pnpm vitest run --project unit \
  packages/npm-client/src/linker-bin-claim-settlement.contract.test.ts
pnpm --filter @riftydev/npm-client typecheck
```

No production source, package root, VFS path, linker entrypoint, compat, or
changelog diff is present at this checkpoint. Runtime result: 8 RED and 1
GREEN; package typecheck adds exactly four intentional `TS2578` REDs while
`preflightPackageBins` is absent.

The first isolated Contract+RED review at
`423cbaaa5ad461fbbf59581e1afc24e2427514d2` passed Standards and blocked
Spec: the successful current order matched one descending comparator,
owner-transition rejects also changed target, and full-owner removal did not
prove a missing prior command while that owner survived. The in-place re-cut
adds a non-monotonic four-claim current order with shuffled prior sources,
same-target/different-owner current and prior witnesses, and partial command
removal. Runtime now reports 9 RED and 1 GREEN; package typecheck retains the
same four intentional `TS2578` REDs.

The second isolated Contract+RED review at
`df25cdacf9d2c4bab5711aaf351f032768a2b46d` passed Standards and confirmed
the first three blockers closed, then blocked Spec: compaction had removed the
only successful omitted-prior runtime call and string-form source. Per Contract
escalation, the in-place re-refinement folds one nested scoped-string,
omitted-prior success into the vertical output test without widening the unit.
The runtime and type RED ledgers remain unchanged.

The next isolated review at
`2d0608ce9f7f28a603fcc36107b5468609c877b7` confirmed every earlier blocker
closed, then blocked Spec on two remaining identity false-greens: all current
collisions shared a target, and the prior collision had only one input order.
The in-place carrier now pairs opposite-order different-target root collisions
with same-target nested collisions and adds the reversed prior collision. It
remains below the `2×` carrier boundary. Runtime now reports 10 RED and 1
GREEN; package typecheck retains the same four intentional `TS2578` REDs.
