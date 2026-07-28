# ADR-0329 Save trust Contract+RED

Recorded 2026-07-28 from source baseline
`84c810c8e4ad70a7334abfe46dda578440f6440b`. The reviewed Contract+RED SHA
adds only contract/probe material and the executable RED tests named below;
it contains no production-source change.

## Public Chromium RED

Command:

```sh
pnpm exec playwright test tests/e2e/vite-save-trust-rebind.spec.ts \
  --project=chromium-light --workers=1
```

The real Vite 7.3.6 user path creates warm named B, boots trusted Scratch A,
writes a unique ordinary marker below `node_modules`, blocks snapshot and
registry routes, then requires A→Save→B→A to remain LIVE with the marker and
zero acquisition requests.

Current-main result: RED after 2.3 minutes. Save attempted
`/snapshots/vite-node-modules.json.gz`; blocking that request produced
`snapshot-fetch-failed`, then `npm: install failed: Failed to fetch`, and the
immediate post-Save LIVE assertion timed out. This is the desired-behavior
failure, not the green characterization in
`vite-save-acquisition-probe.md`.

## Authority and fault REDs

Commands:

```sh
pnpm --filter @riftydev/workbench exec vitest run \
  src/glue/install-stamp-project-save.test.ts \
  src/workers/package-acquisition-project-save.test.ts \
  src/workers/playground-project-catalog.contract.test.ts
```

The suites are executable contract tests committed beside their authorities.
Before source implementation they fail at the absent Save-specific authority
operation and the current claim-free target. Focused runs fail with
`authority.projectSave is not a function` and `expected absent to match
trusted`, respectively. Together they retain:

- trusted rebind and already-untrusted claim-free Save;
- source root, slug, artifact, package, and lock rejection siblings, plus
  target package, lock, pre-existing claim, and same-root refusal;
- target demote/write, full-ledger proof, promotion, catalog pointer, crash,
  quota, and permission boundaries;
- one existing-FIFO order across Save, install, and child admission;
- top and nested reserved-claim exclusion with only the target project root
  newly trusted.

The tests use the real install-stamp, package acquisition, owner VFS, and
catalog authorities. Only the storage failure boundary is injected.
