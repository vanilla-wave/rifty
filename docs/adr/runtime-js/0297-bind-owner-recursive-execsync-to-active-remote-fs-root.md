# ADR 0297: Bind owner-recursive execSync to active remote FS root

Status: Accepted
Date: 2026-07

> TL;DR: owner-served recursive `execSync` resolves public paths through the
> active project view and mounts that exact private root in the nested worker.

## Context

Workbench terminals expose a project as `/`, while the owner authority stores it
under `/.rifty/workbench/v1/projects/<id>/tree`. A supervised `node` child
therefore reports `cwd=/` and `node:fs` correctly sees `/child.mjs` through its
rooted remote view.

Its first `execSync('node child.mjs')`, however, is serviced by the Workbench
owner's dispatcher. The handler preflight read the unrooted authority, so it
reported `ENOENT /child.mjs`. Rooting only that preflight is insufficient: the
owner worker is not itself a Node entry, so ADR-0267's inherited launch metadata
has no private root to copy into the nested child. The nested loader would then
read the same wrong owner path. Fault class: split namespace authority across
preflight and recursive spawn.

## Decision

`InstallRuntimeJsExecSyncOptions` gains a host-only `remoteFsRoot` accessor. It is
read once per admitted request, must return an absolute normalized non-root path,
and travels on `NodeEntryRunSpec` into the versioned node-entry launch envelope.
It never enters argv, cwd, or `process.env`.

The Workbench owner binds both sides to the same active project root:

- preflight uses `ProjectTerminalFsSync(authority, activeRoot)`, preserving the
  public `/child.mjs` path handed to the recursive loader;
- recursive launch carries `activeRoot` as `remoteFsRoot`, so the nested child's
  public `/` mounts the same authority subtree;
- no active project is a loud owner-contract error.

A node-entry realm with no explicit accessor keeps ADR-0267 inheritance. The
lazy default installed by first `require('node:child_process')` fills only an
unowned runtime-js handler slot; it cannot replace an explicit host-owned
runtime-js registration.

Rejected: rewrite argv/cwd to physical paths (leaks owner storage into observable
Node state); transport the root in env (contradicts ADR-0267); preflight the
rooted view but spawn unrooted (moves the ENOENT); process-global active-root
state (cross-project lifetime leak).

## Consequences

- (+) Parent `node:fs`, exec preflight, nested module loader, and nested `node:fs`
  observe one project namespace.
- (+) Sequential project sessions resolve the root at request time; no stale
  root is captured at owner boot.
- (+) Host metadata remains private and versioned per ADR-0267.
- (-) The public exec-sync host options and internal recursive-run spec widen;
  every custom runner must preserve the optional private root.
- Builds on ADR-0039, ADR-0150, ADR-0267; no compatibility decoder or env fallback.
