---
area: shell
status: parked
title: grep/find frozen-GNU byte-fixtures deferred; ls --color/-l not byte-fixtured
created: 2026-06-08
why: ADR-0093(b) wants frozen-GNU golden fixtures as the oracle for ls/grep/find; ggrep/gfind not installed on the box, so grep/find ride hand-asserted conformance tests instead
user_story: As a rifty contributor, I want `grep`/`find` output byte-checked against real GNU like `ls` already is, but today ggrep/gfind aren't on the box so they ride hand-asserted conformance tests, no golden oracle.
sources: [Q-2026-06-07-411, adr/shell/0093-shell-command-parity-harness.md, adr/runtime-js/0050-no-symlink-fs-realpath-fs-lstat-semantics.md]
code: [packages/shell/fixtures/ls/]
---

## Context

Landed: `ls` byte-frozen vs gls (GNU coreutils 9.7) for default/-a/-A/-1/-r (`packages/shell/fixtures/ls/`). NOT fixtured (recorded, no silent cap): (1) grep — ggrep absent → 22 conformance tests; (2) find — gfind/findutils absent (box aliases find→bfs) → 12 conformance tests; (3) ls --color — gls emits leading `ESC[0m` + zero-padded `01;34` vs our `ESC[1;34m`, structural assert only; (4) ls -l metadata — fixed placeholders per ADR-0050 (no real perms), regex only.

## Options or Next

Defer grep/find byte-fixtures to the milestone-DoD closer (`brew install grep findutils` → ggrep/gfind, `LC_ALL=C`, version+locale header, or a Linux box). ls --color/-l stay structural unless real SGR-LS_COLORS / perms land.

## Reversibility

REVERSIBLE — test infra (CHANGELOG-only).
