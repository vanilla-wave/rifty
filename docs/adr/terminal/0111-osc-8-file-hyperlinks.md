# ADR 0111: OSC 8 file hyperlinks

Status: Accepted (2026-06-09)
Date: 2026-06-09

> TL;DR: TTY grep paths become safe editor links

## Context

Backlog asks for OSC 8 file/editor hyperlinks. xterm already supports OSC 8 via
`linkHandler`; shell builtins know `ctx.isTTY`; playground has `editorApi.openFile`.

## Decision

Ship the narrow first slice:

- `grep` wraps file prefixes in OSC 8 only when `ctx.isTTY`;
- URI is `file://<resolved-vfs-path>`, label stays GNU/as-given;
- terminal wrapper routes OSC 8 activation through `webLinks.onLink`, permitting
  non-HTTP protocols only at that host-owned seam;
- playground opens only `file:///workspace/...` links, normalized, no traversal;
- no `ls` links yet, preserving column/parity surface.

## Consequences

- Non-TTY output and redirects stay byte-stable.
- File links are host-policy-gated, not terminal-policy-gated.
- `ls`, diagnostics, and line/column jump links remain follow-ups.

## Acceptance

- [x] Shell tests cover OSC 8 helper and `grep` TTY-only wrapping.
- [x] Terminal tests cover xterm OSC 8 `linkHandler` wiring.
- [x] Playground tests cover safe file URI normalization/rejection.
- [x] Backlog/changelogs record shipped scope.
