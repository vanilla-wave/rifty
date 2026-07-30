---
area: toolchain-build
status: draft
title: Use each BSD script(1) launcher dialect in TTY parity
created: 2026-07-30
why: the TTY parity runner groups four BSD hosts behind macOS/FreeBSD argv that OpenBSD and NetBSD do not accept
user_story: As a rifty maintainer running Node parity on OpenBSD or NetBSD, I want the TTY case to launch its Node oracle, but today script(1) rejects or misreads the macOS-style argv.
sources: [PR #223 TTY parity sibling sweep, https://man.openbsd.org/script.1, https://man.netbsd.org/script.1, https://man.freebsd.org/cgi/man.cgi?query=script&sektion=1&manpath=FreeBSD+12.0-RELEASE]
code: [tools/node-parity-runner/src/run-in-node.ts]
---

## Context

No backlog title, `code:` entry, item, or epic child matched this launcher
defect on 2026-07-30. `nodeRunnerFor` currently sends
`script -q /dev/null node entry` on macOS, FreeBSD, OpenBSD, and NetBSD.
macOS/FreeBSD accept `file [command ...]`; NetBSD requires `-c command`, and
OpenBSD supports only `-a`/`-c` and has no `-q`.

User path: `pnpm test:parity` reaches `process/tty-resize.case.ts`; the native
oracle must start under a real PTY before any rifty comparison exists. No
OpenBSD/NetBSD runtime was available during intake, so the draft records the
official launcher-contract mismatch rather than claiming a reproduced process
result.
