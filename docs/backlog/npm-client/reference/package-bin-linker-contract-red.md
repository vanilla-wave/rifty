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
