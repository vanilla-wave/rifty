---
area: distribution
status: draft
title: A sandbox run reads template files on demand from the worker instead of copying the whole template into its isolate
created: 2026-11-25
why: The template goal copies the template into every run's isolate (user 2026-11-25), so a run pays ~90–100 MiB of isolate memory and ~+50 ms per `exec` for a four-library template — growing with the template; reading template files lazily makes both independent of it (requirements §3).
sources: [/Users/vanilla-wave/ai/rifty-requirements/2026-11-24-server-sandbox-requirements.md §3, ADR-0572, docs/backlog/distribution/reference/isolate-host-sandbox-template-probes/README.md]
code: [packages/isolate-guest/src/guest/entry.ts, packages/isolate-host/src/child/main.ts]
---

## Context

User, 2026-11-25, «ок» to: «сейчас копировать шаблон в изолят … Ленивое чтение записать в backlog
с поводом взяться: память на одновременный прогон становится узким местом или шаблон заметно
растёт» (template goal Decisions).

Measured (probe L, arms `views` = materialize vs `lazy`, T95 = 23 654 files / 88.8 MB): `exec`
190 vs 80 ms (semver), 454 vs 406 ms (pdf-lib); isolate floor 123 vs 19–23 MiB; T1 (1 MB) equal.
Design (ADR-0572 §Forks F1 (b)): an `FsSync` overlay in the guest realm — the sandbox's difference
over the template, read through three sync host functions (`stat`, `read`, `readdir` of a template
path: exact lookup in the worker's immutable map, copies out); no SAB (isolated-vm sync callbacks).
Costs to settle at pickup: the overlay's writable mode (copy-up, deletion marks, rename of a
template directory), a guest-side cache (pdf-lib's `require`: ~6 200 stats + 915 reads ≈ +14 µs
each; `fs.readSync` reads the whole file per chunk), and the user's words it touches: «Владелец ФС
живёт в том же realm, что и гость (внутри isolate)» (template layer only) and «харденинг нужен
только на внешнем шве: выставленные хостовые функции…» (3 new read-only functions).

Owner: distribution (isolate host). Trigger: isolate memory per concurrent run becomes the
consumer's bottleneck, or the template grows well past the four libraries.

## Challenge

challenge: 2026-11-25 — none yet (user-deferred capture; premise critic of 2026-11-24, template goal `## Challenge`)
