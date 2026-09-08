---
kind: epic
status: draft
title: Reopen persisted no-COI projects without replacing installed files
created: 2026-09-08
value: Embedded IDEs reopen a persisted Node project with usable runtime adapters and retained local dependency edits, while explicit installs avoid redundant OPFS writes and never hide persistence failure.
user_story: As an embedded IDE user, I want to reopen and build my saved Vite project without reinstalling or losing dependency edits, but the SDK currently requires install to initialize the fresh worker adapters.
tier: works
---

## Context

Source: [issue #319](https://github.com/vanilla-wave/rifty/issues/319).
The reported 0.6.0/Vite 7.3.6 reopen spends most post-boot time persisting
unchanged dependencies. On checkout da485021f, an executed real Chromium/OPFS
probe with nanoid 3.3.18 independently confirms 26 writable acquisitions on
repeat install, zero registry requests, and install success despite a native
QuotaExceededError recorded by flush. No local Vite timing/repair claim.
Evidence, dedup, raw user decisions and reproduction:
[research](../../distribution/reference/issue319-refine-evidence.md).

## Outcome

A supported SDK warm-open action restores runtime readiness from a compatible,
proven prior installation without replaying installation or replacing saved
package bytes. Trust describes the installation protocol and request/policy
identity, not pristine current dependency contents (ADR-0307). Explicit install
remains the operation that reconciles/repairs dependencies.

Also deliver issue #319's independent improvements: honest install/build
persistence errors, safe elimination of redundant installer writes/directories,
and less repeated native OPFS handle lookup during boot. Keep generic fs write
semantics, native handle behavior and eager-read correctness. Vite is an
acceptance example, never infrastructure policy (ADR-0375).

## User scenario

1. An existing embedded app uses the public no-COI SDK, a self-hosted toolchain
   Worker, real OPFS and the project/cache setup from issue #319. Explicitly
   install Vite 7.3.6 and build successfully, then close the sandbox/page.
2. Recreate it over the saved installation. Invoke the documented warm-open
   action, then build: adapters work, no installer/relink or registry request
   runs, and opening itself does not replace dependency files.
3. Edit a dependency file, add a file or delete one, close and reopen with the
   same installation request. Preserve that state; executing a deleted/broken
   module may fail normally. A same-length edit is not classified as corruption
   just to overwrite it. Source edits also remain intact.
4. Explicit install is the requested repair action. From the retained replay
   cache, restore changed/missing package files under current installer behavior;
   unchanged provably durable files/directories avoid redundant persistence.
   Do not claim this repair policy is upstream npm's behavior.
5. Missing/unproven installation authority, incompatible SDK policy, or request
   drift cannot authorize silent reinstall. Preserve saved bytes and report that
   explicit install is required if compatibility cannot be established without
   mutation. A known storage failure never becomes successful durability.
6. Repeat boot/install and measure native calls separately from elapsed time.
   Inject real storage-boundary failures and verify install/build rejection.

## Invariants

Baseline: da485021fab3f9f881ebafe29106b604f347b2b3. I1/I2 are missing public
warm-open behavior (source + issue); I3/I4 have the executed nanoid probe;
I5 is absent in OpfsVfs lookup/init code and has baseline native-call counts.
These are proposed delivered results, not passing acceptance proofs.
FIT rechecked current main 9a6331194f4b67245c2ab118a72f93920da584c5: the two
intervening commits change review entry/Express drain ownership, not these
missing public warm-open, flush-report, installer or OPFS lookup boundaries.
The baseline absence evidence remains applicable; see the research FIT record.

1. I1. Full sandbox/page recreation has a supported warm-open path that validates
   compatible installation authority and activates fresh-worker adapters without
   npm replay, dependency relinking or registry requests. Missing/incompatible
   authority fails explicitly with saved bytes retained; it never silently
   installs, reseeds or adopts an unproven claim.
2. I2. Warm-open preserves saved dependency edits, extra files and deletions;
   normal execution sees that state. Only explicit install performs the issue's
   changed/missing-file repair. Unchanged Vite builds work after warm-open;
   repaired Vite builds work after explicit install using retained replay data.
3. I3. A persistence failure reported by OPFS rejects install/build rather than
   returning success. Unreadable preload bytes cannot become fabricated empty
   content used as proof of equality, valid activation or successful recovery.
4. I4. Explicit install avoids redundant writes of verified identical nonempty
   package files and recreation of verified durable recursive directories,
   retaining lock/integrity checks and changed/missing-file repair. Dirty or
   unknown persistence state retains its ordinary write/heal/failure path;
   empty cache bytes alone never justify skipping a write.
5. I5. OPFS boot/preload avoids repeated handle acquisition and duplicate
   concurrent root initialization, with fewer native lookup calls than its
   baseline. File content reads stay fresh; deletion/recreation, already-returned
   directory views and native receiver/argument behavior remain correct.

## Decisions

- 2026-09-08 — FIT: all identified user forks resolved; reuse the checked I1–I5 destination and tier, retain three agent-owned route questions, seed the independent I3 persistence-error draft; no implementation authorized by this preparation.
- 2026-09-08 — user, final repeated round 1: «Сохранять правки при открытии; восстановление — только по явному install»; supersedes the earlier selection of repair-on-open.
- 2026-09-08 — issue repair examples now belong to explicit install; open cannot distinguish intentional edits from corruption, consistent with ADR-0307.
- 2026-09-08 — user requested PR #316 context; its saved-state priority/incompatibility-preserve decisions corroborate this direction, without importing its COI-only snapshot/namespace APIs or production tier.
- 2026-09-08 — keep existing no-COI tier works (ADR-0377); known persistence faults may reject, never claim successful durability; no new crash-atomic tree promise.
- 2026-09-08 — API names, compatibility/activation evidence carrier and OPFS handle ownership remain agent decisions, with ADR/probes at FIT/PICKUP; no generic TrustedState extraction prescribed.
- rejected route: use only a faster automatic install on every open — violates I2 by repairing user edits.
- rejected route: omit install without activating runtime adapters — violates I1; issue reports an uninitialized esbuild runtime slot.
- rejected route: treat a Workbench stamp as a pristine tree hash or add byte surveillance between installs — violates I2 and ADR-0307.

## Challenge

Fresh read-only critic: `/root/warm_reopen_critic`; verbatim verdict:

challenge: 2026-09-08 — clear

Направление достаточно обосновано для draft epic. Issue #319 требует четыре результата; локальный probe подтверждает повторные записи и ложный успех при QuotaExceededError. Числа большого Vite-проекта остаются downstream evidence, не измерением main.

Дешёвый конкурент — только дедупликация `install()` — сохраняет ремонт изменённых файлов и потому нарушает последнее решение пользователя: «Сохранять правки при открытии; восстановление — только по явному install». Пропустить install целиком также недостаточно: issue фиксирует неинициализированный esbuild adapter. Поддержанный warm reuse с активацией необходим; конкретный API и носитель доказательств остаются агентскими решениями.

PR #316 подтверждает применимость принципа saved-state priority и запрета автоматической перезаписи при несовместимости. Его COI/snapshot/namespace/production scope сюда не переносится.

Материальные переходы закрываются существующей властью:

- Старые установки 0.6 без пригодного подтверждения; изменённые manifest/lock или несовместимая SDK policy: сохранить байты, явно сообщить необходимость install. Не объявлять отсутствие доверия отсутствием проекта; не принимать старый stamp без проверки его протокола.
- Изменённые, повреждённые или удалённые dependency bytes после подтверждённой установки: ADR-0307 запрещает whole-tree surveillance. Открытие сохраняет байты; выполнение использует их либо выдаёт обычную ошибку отсутствующего модуля. Явный install сохраняет запрошенный в issue текущий ремонт.
- Известная ошибка/неопределённость persistence: нельзя объявлять успешное сохранение или доказанную пригодность. Tier `works` допускает явный отказ; не требует crash recovery, журналирования или eviction protection.
- OPFS handle reuse: отдельно измерять эффект; свежие чтения, удаление/пересоздание, старые directory views и native argument/receiver semantics уже прямо требуются issue.

Новых пользовательских развилок не выявлено. В draft нельзя называть доверие доказательством неизменности dependency tree, обещать автоматический ремонт при open или закреплять generic TrustedState framework. Для новых публичных/долговечных механизмов понадобится ADR при PICKUP. Свежая проверка окончательного комплекта документов остаётся обязательной.
