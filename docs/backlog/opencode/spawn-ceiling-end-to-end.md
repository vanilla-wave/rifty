---
area: opencode
status: parked
title: End-to-end spawn-ceiling test vs opencode's real Git.run/bash (over the conformance marker)
created: 2026-06-08
why: the conformance test pins the ceiling on rifty's own substrate; full e2e vs opencode's real tools is future once opencode is vendored+driven
sources: [Q-2026-05-30-119, audit-digest]
---
## Context
`child_process-ceiling.test.ts` (F09-T4) is a CONFORMANCE contract (not Node-parity — real Node WOULD spawn git/bash), pinning the IMPOSSIBLE side of the tool ceiling as behavior: `spawn('git'|'bash')` falls through `spawnViaSameRealm`→`execScript` and surfaces `spawn <cmd> ENOENT\n` with exit 127 (never fake-succeeds); `child.stdin.write` throws `NotImplementedError`; PTY throws on session-create. Asserts on `git`/`bash` only (both always fall through, independent of the SAB/kernel-worker-url gate which only routes `node <script>`). This pins rifty's OWN spawn substrate — which is what every impossible opencode tool transitively hits.
## Options / Next
Decision (Q-2026-05-30-119, provisional): pin the ceiling by the rifty-substrate conformance test NOW (opencode not driven for its tools). DEFERRED: a higher-fidelity end-to-end test driving opencode's REAL `Git.run` / bash tool / ripgrep tool against the rifty substrate — future once opencode is vendored AND a tool-substitution layer is wired. Standing regression guard; promote only when the facade actually exercises tools.
## Reversibility
REVERSIBLE — test-only, no production code/API/dep (Q-2026-05-30-119). Parked: the e2e-vs-real-opencode upgrade waits on the tool layer being wired.
