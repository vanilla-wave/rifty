---
area: distribution
status: draft
title: A sandbox's template is a layer outside its state, so a run's and a host op's cost do not grow with the template
created: 2026-11-25
why: The template goal puts the template's `node_modules` into every sandbox's state (user 2026-11-25, «начать с самого простого»), so each `exec` restores and captures ~88 MB (~0.6 s for an empty file), each sandbox holds a copy, and a host write encodes the whole state — requirements §3, declared deferred.
sources: [/Users/vanilla-wave/ai/rifty-requirements/2026-11-24-server-sandbox-requirements.md §3, ADR-0572, ADR-0568, docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/README.md, docs/backlog/distribution/reference/isolate-library-probe/README.md]
code: [packages/isolate-host/src/sandbox.ts, packages/isolate-host/src/child/main.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

User, 2026-11-25, on the lifecycle fork: «Как будто можно начать с самого простого и дальше
оптимизировать. Что в данном случае будет самым простым?»; «ок» to starting with «библиотеки =
файлы песочницы» while «слой шаблона и живой изолят уходят в backlog следующими ступенями»; the
accepted description named what is deferred: «своё требование §3 „стоимость не зависит от размера
шаблона"» (ADR-0568 Corrections 2026-11-25). The contract the template goal publishes stays; this step only
lowers its numbers (goal Decisions «contract stability»).

Price today (library probe, four-library state, 24.11, load 7–30): warm `exec` of an empty file
601 ms, generators 0.83–0.99 s; `maxFsBytes` ≥ 94.9 MiB; smallest `memoryLimitMb` 209–222; state
88.1 MB per sandbox; a host write encodes the whole state (README: 56 MB → 69 ms). The template
goal's README table re-measures it through the public API.

Ready material: ADR-0572 (Proposed, not accepted, not withdrawn) — one `LayeredFsSync` (rifty's
`MemoryFsSync` with template entries materialized lazily; state by node identity: an untouched
template node one row, anything else explicit) for host ops and the run, a template once per process
and per worker, the cap over the difference, both modes. Probes
`docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/`: L (per-run cost of
four ways a run sees a template; T95: `full` 392 ms semver / floor 215–219 MiB, `layered` 86 ms /
99–103 MiB), H (a per-sandbox views FS rejected: `writeFile` 30.8 vs 0.02 ms), W (touched-entries
sweep), S (changed paths vs Node), G — the generated-sequence equality of the layered FS with
rifty's FS without a template, **the layer's acceptance** (`gen.mjs`: 0 / 3 000 differ; the
rejected `layered-v1` 302 / 3 000, `layered-v2` reads grew the state 3 000 / 3 000). Absorbs at
pickup: `distribution/isolate-host-binary-request-frame` (a template to a worker once, as bytes),
`distribution/isolate-host-sandbox-write-cost-per-state` (O(write) cap), and is the base of
`distribution/isolate-host-sandbox-template-lazy-read` and `-template-snapshot`.

## Question

The layer's open bound — owner: user — asked 2026-11-25 by the manager, unanswered when the user
chose the simple start: a host op's cost and an idle sandbox's memory are bounded by the entries of
the template directories touched since the sandbox's last run plus those of every template
directory marked since its creation (touching a directory — first read, `list`, `stat`, a write,
removal, rename or copy in it — touches all its entries; a mutating call marks it, a failed one
too, a read-only refusal not; a mark persists through runs; a run boundary resets what only reading
touched); ceiling the whole index (≈0.5 KiB idle per entry, growing with path length:
four-library template 8 793 entries, a whole walk 32 ms and 4 290 KiB per idle sandbox, 3 KiB after
a run boundary; 35 001 synthetic entries 127 ms / 17 983 KiB); never by bytes; a marked directory
carries a row per entry on the wire and in the cap (384 + 8 × path length + 80 × depth units; a
write in `pdf-lib` 189 rows, 0.2 % of the 64 MiB cap) (probe W). Options as asked: (1) accept as a
declared narrowing of §3 + an item with trigger «touched + marked entries above N or idle memory
per sandbox above M»; (2) redesign — a directory delta (`lazy(O)` + changed children + removed
names) with per-entry lazy lookup, checked by probe G's generator and mutants before it lands.

Also open with the layer (owner: agent, at pickup): the process registry's release (a consumer
rebuilding its template keeps every old one); the run's per-call overhead of the layered class
(probe F: +16…+39 ms per generator) against ADR-0572's F1 return condition; the read-only oracle on
a Linux read-only mount.

Owner: distribution (isolate host). Trigger: a consumer's `exec` latency or per-sandbox memory with
a template becomes its bottleneck (the isolate-host README §Sandbox template table is the baseline), or the user
picks this step over `distribution/isolate-host-sandbox-live-isolate-per-turn`.

## Challenge

challenge: 2026-11-25 — none yet (user-deferred capture; premise critic of 2026-11-24 on the layer, ADR-0572 §Forks)
