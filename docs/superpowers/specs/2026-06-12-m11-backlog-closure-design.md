# M11 Backlog Closure Design

## Context

Branch `codex/m11-backlog-closure-pr21-finish` starts at PR #21 head
`4ddfe4f`. PR #21 already closes the first M11 slice:

- open runtime/trust posture docs
- local `node:http` client loopback
- package.json-driven install + bin linking
- OPFS structural flush tracking
- runtime-js fd APIs + `node:os` constants
- runtime-wasi positional fd syscalls
- public sandbox FS read/write RPC (ADR-0131)

The remaining M11 live set is derived from:

```bash
rg -l "M11" docs/backlog
```

The files fall into two groups:

- **Active closure items:** `runtime-js/sourcemap-remapping-error-overlay`,
  `runtime-js/vm-subset-node-test-support`,
  `vfs/storage-durability-and-portability`,
  `npm-client/prod-npm-registry-proxy`,
  `process-meta/compat-generate-on-milestone-dod`,
  `toolchain-build/ts-esm-parity-node-reference`.
- **Residual parked/blocked items:** items whose own frontmatter says the gate is
  not met, or whose implementation would add public API/new package/deploy
  behavior and therefore needs a later ADR or explicit outward action.

No visual companion is needed; this is code/docs/runtime closure.

## Approaches

### A. Close Active M11 Items, Retarget Residuals

Implement or ratify the active items with tests and one commit per item. For
parked/blocked residuals, remove them from the M11 live set only when the item
itself already says the gate is post-consumer-ready or blocked by a future ADR.
Record each retargeting decision in the decisions log.

This is the recommended approach. It honors ROADMAP M11 without pretending that
new public APIs, new packages, or live deploys can be silently folded into the
current PR.

### B. Implement Every M11-Tagged File

Treat every `M11` mention in `docs/backlog` as immediate implementation scope.
This would force public API work (`Sandbox.exec`, snapshot/fork, workbench
package), kernel behavior changes, and deployment decisions into one PR. It
conflicts with the decision workflow and would make review nearly impossible.

### C. Documentation-Only Closure

Retag everything out of M11 and leave runtime gaps open. This would make `rg`
look clean but would not satisfy the M11 Consumer Ready intent.

## Design

### Closure Policy

The completion target is:

- active M11 items are implemented, ratified, or verified with fresh evidence
- parked/blocked residuals are explicitly retargeted out of the M11 live set
- no unexamined `M11` backlog item remains
- decisions are logged in `docs/superpowers/decisions/2026-06-12-m11-backlog-closure.md`
- each backlog item closure has its own commit

`docs/backlog` stays the source of open work. Removing an M11 tag is allowed only
when the file remains as a non-M11 backlog item with a clear gate, or when the
item is fully closed and the file is deleted.

### Implementation Slices

1. **Toolchain parity ADR.** Promote the already-chosen `ts-esm` Node-side
   `tsx` reference decision to an ADR, remove the two source TODO markers, and
   delete the backlog item.
2. **Prod npm registry proxy.** Add the prod `/npm-registry` function/config
   source and tests. Do not deploy from this session.
3. **Runtime-js VM/test surface.** Add a small honest `node:vm` subset first.
   Treat `node:test` as a separate runner-sized surface: implement only if the
   plan can keep it deliberately tiny and tested; otherwise retarget it as a
   post-M11 residual with the VM subset cited.
4. **Runtime-js source-map stack remap.** Add source-map-aware stack remapping
   for transformed TS/JSX guest modules without changing the public
   `TransformSourceHook` return type. Use inline maps/registering inside the
   loader. If playground overlay/cross-worker rendering proves larger than the
   M11 closure slice, retarget that tail as a separate post-M11 backlog item
   with the implemented loader remap cited.
5. **Durability and portability.** Add storage persistence/quota probe helpers
   plus project export/import over the existing snapshot shape. Avoid new
   dependencies; prefer a documented JSON snapshot format unless a tar/zip need
   is proven.
6. **Compat milestone pass.** Make the smallest useful generated/manual compat
   update for fs/streams/http from existing conformance/parity inventory, run
   `pnpm compat:generate`, and close the M11-specific obligation while leaving
   broader generator automation as toolchain backlog if still skeleton-only.
7. **Residual retarget sweep.** For parked/blocked M11-tagged files whose gates
   are not met, retarget them out of the M11 live set and log the decision.

### Testing

Use TDD for each code-bearing item:

- write a failing unit, conformance, parity, or integration test first
- run the narrow test and capture the expected failure
- implement the minimal code
- rerun the narrow test
- run area-level verification before commit

Parity is preferred for Node-observable behavior:

- `node:vm` and `node:test` get parity or conformance tests where the real Node
  runner is a meaningful oracle.
- Source-map remapping gets loader unit coverage and a `ts-esm` parity case when
  line mapping is observable under both Node/tsx and rifty/esbuild.
- Prod proxy gets unit tests against the handler and config docs; live deploy is
  confirm-first and outside this PR.
- Storage export/import uses real Memory VFS or snapshot frames, not mocks of
  the unit under test.

### Review

After each item commit:

- run the relevant verification
- request/review focused code feedback
- fix critical/important issues before moving to the next item

Final verification:

- `pnpm docs:check`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm check:deps`
- relevant `pnpm test:run` slices
- `pnpm test:parity` for changed parity cases
- `pnpm compat:generate`
- `rg -n "M11" docs/backlog` to prove no M11 backlog live set remains

## Self-Review

- No unresolved placeholders in this spec.
- Scope is decomposed by backlog item, matching the one-commit-per-item rule.
- Public API/new package/deploy decisions are not silently made; they are either
  ADR-backed, retargeted, or confirm-first.
- The design does not relax test policy: bug/problem gaps get failing tests first.
