---
area: distribution
status: draft
title: Operate on no-COI project files through the public SDK
created: 2026-09-10
why: SDK file tools need eval strings and temporary files for operations already supported by the worker VFS
user_story: As an embedder exposing project tools to an agent, I want directory and file operations with structured results and honest mutation completion.
sources: [https://github.com/vanilla-wave/rifty/issues/325, docs/backlog/distribution/reference/product-integration-issue-triage.md]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/protocol.ts, packages/runtime-js/src/worker-fs-rpc.ts, packages/runtime-js/src/worker-entry.ts]
---

## Context

Static audit at `2c7f9bbf4`: RuntimeFs/FsRequest expose only readFile/writeFile.
Eval prints inspected values to stdout and returns value: undefined. The issue's
public-API gap is confirmed; no new browser reproduction is claimed.

## Question

Expose readdir, stat, mkdir, rename and removal alongside read/write using the
existing worker VFS and error/durability boundary. Preserve current root-anchored
RuntimeFs paths; project-scoped file and shell calls must agree. New mutations
must also compose with restart recovery, not resurrect removed/renamed files.

#325 explicitly allows either supported structured evaluation or a clear
distinction from console-oriented eval. Recommendation: ordinary file APIs plus
per-command results first; document eval's console contract. General structured
eval remains an open alternative, not a committed extra RPC framework. If chosen,
non-cloneable/oversized results must fail explicitly and stdout stays separate.

## Proposed grouping

Iteration 2 with `public-api-ai-agent-exec-preview.md` (#326): shared project path,
mutation and recovery semantics. Prove real public file CRUD plus command run →
stop → next run in one packed browser consumer; persistent temp files must not be
needed for returning results. File operations can land before stop semantics.

## Decisions

- Draft captures #325 and an agent-proposed grouping; method names and structured-eval choice are not settled user decisions.
- No matching FS CRUD draft found; ADR-0131 read/write is the existing baseline.
- Host owns allowed paths, tool schemas and result formatting; path/readonly convenience is not a security boundary.
