---
kind: epic
status: ready
title: Compact dependency snapshots for prepared no-COI SDK environments
created: 2026-10-23
value: Download and restore prepared Vite/esbuild dependencies without carrying unused replay archives.
user_story: As an embedded-editor developer, I want smaller prepared dependency snapshots, but today Rifty requires replay tarballs even when my editor never reinstalls dependencies.
tier: works
---

## Outcome

An explicit compact profile omits acquisition archives while retaining the
prepared executable dependency tree. The no-COI SDK applies it and runs real
installed Vite/esbuild without registry acquisition. No new install ban.
Ordinary replay-capable snapshots retain their contract.

## User scenario

1. Produce an ordinary and a compact snapshot from the same real Vite 7.3.6 project
   and npm lockfile using the public producer. Compact output carries prepared
   `node_modules`, including `esbuild-wasm`, but no replay acquisition archives;
   its compressed transfer is smaller. Existing package admission rules apply.
2. In a fresh Chromium no-COI SDK sandbox with no registry connection, apply the
   compact snapshot through `toolchain.applySnapshot`, read/edit project source
   and run installed `vite build` via `toolchain.runBin`. The build succeeds with the expected edited
   result and no registry/Eddy acquisition.
3. Persist, close and reopen the project; files and builds remain usable without
   replay or a registry connection. Explicit restoration reapplies the prepared
   snapshot using existing conflict/force semantics; build succeeds again.
4. The editor never invokes install. Explicit host/shell install keeps existing
   semantics, including cache-miss failures; compact output promises no offline
   reinstall. It adds neither a blanket prohibition nor network fallback.

Preserve current file access, application validation, conflict and persistence
contracts. Reapplication is the existing payload overlay, not a new whole-project
reset or cache purge. No added atomicity for interruption/quota failures.

## Invariants

Main `c392669742a27b1c8c47ca0edaf4c8c579e90edf` has no producer profile and
requires exact replay closure before SDK application. Three executed missing/
corrupt-cache cases reject before mutation. Therefore I1 has no producer result,
I2 cannot admit that result, and I3 cannot distinguish valid compact input from
an incomplete replay snapshot. Sources, commands and size probe:
`playground/reference/replay-cache-profile-refine-2026-10-23.md`.

1. I1. Public production offers an explicit compact snapshot with the prepared
   dependency payload preserved and no replay acquisition archives. On the
   scenario's same-input Vite pair its compressed size is smaller than ordinary
   output; no universal byte or percentage target.
2. I2. That compact result completes the SDK scenario: apply, read/edit/build,
   saved reopen/build and explicit reapply/build, without registry acquisition
   or replay-cache writes. Existing shared cache entries are preserved.
3. I3. Updated SDK validation admits valid compact snapshots explicitly while
   rejecting corrupt/incompatible input before application. Ordinary snapshots
   still require exact replay closure/SRI; legacy input and saved projects keep
   existing behavior. Unsupported readers reject compact input before mutation.

## Challenge

challenge: 2026-10-23 — clear

После ответов scope закрыт: обязательный потребитель — no-COI SDK; отдельный явно выбранный профиль уменьшает снимок для подготовленного Vite/esbuild-окружения. Измеренная экономия текущего tar-представления — 3,75–3,81 MB; успешность нового restore/build ещё предстоит доказать.

Редактор не вызывает install; новый запрет не нужен. Явный install сохраняет существующие исходы, включая отказ при отсутствии replay-байтов; наличие registry само по себе не обещает успешный shadow replay. Компактный профиль не обещает offline reinstall.

Обычные снимки, существующее saved-state поведение и гарантии проверки/применения сохраняются. SDK apply → build → reopen → повторное применение покрывают выбранный результат. Поддержка других потребителей допустима, но не обязательна. Tier works не добавляет crash atomicity.

Более дешёвый доказанный эквивалент не найден: snapshot-only и отсутствие install в UI не уменьшают архив; raw-file import не сохраняет доказанные snapshot-гарантии; дедупликация с сохранением replay остаётся отдельным нерешённым вопросом. Новых материальных пользовательских развилок не выявлено.

final-check: 2026-10-23 — PASS, fresh read-only RDY-6/FIT8 review of goal,
map, child, predecessor and evidence against raw input/answers; no blockers.
No product implementation or end-to-end acceptance claimed.

## Decisions

- 2026-10-23 — user: «1, но если убирается и в других местах - ок» — no-COI SDK required; other-consumer savings permitted, not required.
- 2026-10-23 — user: «Редактор не вызывает установку; отдельный запрет не нужен (рекомендую)» — no new install policy or successful-reinstall promise.
- 2026-10-23 — tier: works — preserve existing validation/application guarantees; no new crash-atomic persistence or fault-recovery promise.
- 2026-10-23 — compatibility: producer default remains replay-capable; updated SDK reads legacy and compact; unsupported readers reject compact before effects; saved projects need no migration or new profile marker.
- 2026-10-23 — new public profile/format needs an ADR at PICKUP, naming the selective extension of ADR-0346/0386/0420; do not weaken their ordinary-snapshot clauses.
- rejected route: remove cache from ordinary snapshots or reinterpret snapshot-only — violates I3 and existing replay behavior.
- rejected route: only hide install in the editor — violates I1; archive bytes remain.
- 2026-10-23 — predecessor `playground/snapshot-carries-substituted-bytes-twice` retains independent replay-preserving deduplication; no completion or scope reduction claimed there.
