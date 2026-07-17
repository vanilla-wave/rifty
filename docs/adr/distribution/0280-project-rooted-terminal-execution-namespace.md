# ADR 0280: Project-rooted terminal execution namespace

Status: Accepted
Date: 2026-07
Refines: ADR-0278

> TL;DR: one active project presents `/` to Shell, npm, Node, installed bins,
> dev servers, and recursive Workers; owner storage roots remain private typed
> bootstrap data.

## Context

ADR-0278 made terminal snapshots project-rooted, but command execution still
used the lifetime owner VFS. `pwd` and `process.cwd()` exposed a physical
Workbench root, while absolute paths could address inactive projects and owner
metadata. Rewriting display snapshots alone therefore gave Shell and child
programs different filesystem truths.

The terminal needs one Node-visible project namespace. This is project-state
fidelity inside one browser Workbench, not hostile-code containment.

## Decision

Each active project owns one execution namespace. Public `/` maps to its exact
physical tree. Parent traversal cannot escape it; the reserved public
`/.rifty` prefix rejects loudly. Every diagnostic and command output translates
owner paths back to public paths and never exposes the physical root.

`ShellOptions` and `CommandContext` accept an optional injected `FsSync`.
Builtins, redirections, glob/walk, installed bins, background commands, and Git
use that authority. Omission retains the ambient `currentFsSync()` fallback for
existing consumers.

npm accepts public arguments, prefix, cwd, and writers. Its command boundary
maps the invocation to owner paths and maps nested lifecycle Shells back to the
public namespace. The mapping is internal; guest environment variables carry
no project binding.

Node, installed-bin, and dev-server children receive public cwd, argv, and
entry paths. A typed out-of-band `remoteFsRoot` bootstrap field installs the
project-rooted remote filesystem before guest code runs. Recursive Workers
inherit that field through the same typed launch configuration; it is never
encoded in argv or environment variables.

The private PTY protocol may retain owner-rooted cwd state, but the runtime
projects it to public paths before Shell execution and back to owner paths at
the protocol boundary. A destructive mutation whose source or destination is
public `/` rejects before filesystem or package-state effects.

## Consequences

- `pwd`, `process.cwd()`, and absolute paths such as `/package.json` agree in
  direct Shell, npm lifecycle, child, dev-server, and recursive Worker code.
- Owner storage layout and retained sibling projects are not terminal-visible.
- Private transport keeps explicit bidirectional path projection; malformed or
  outside-root state fails loudly instead of being guessed.
- This decision does not add origins, permissions, or a security sandbox.
