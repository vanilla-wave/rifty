---
kind: epic
status: ready
title: Consolidate existing guest-package adaptations under shadow registry
created: 2026-07-18
value: Existing supported programs retain their behavior while guest-package adaptations have one registry owner instead of changing platform contracts.
user_story: As a developer running Vite or another ordinary npm tool, I want package compatibility to follow installed dependencies, but today package-specific preparation also lives in Workbench and runtime-js.
tier: works
sources: [ADR-0263, ADR-0278, ADR-0226, ADR-0371, ADR-0375, PR-167-review]
---

## Outcome

Consolidate all existing guest-package adaptations under shadow registry, including Vite, esbuild and `@emnapi/core`. Inventory the remaining packages at pickup; this is a finite cleanup of existing support, not a promise to support new packages.

Registry owns package-specific versions, integrity policy, patches, runtime adaptation and consumer compatibility preparation. Generic kernel, runtime, VFS, npm, shell, terminal and Workbench supply Node, filesystem, process, module, network and storage behavior. Renaming a package-specific branch to an edge module, or moving only its constants, does not close this outcome.

An adaptation update may require a rebuilt SDK. Independent registry-to-existing-SDK delivery is not required; ownership does not prescribe byte delivery or a public extension system. General platform changes remain legitimate when a package exposes a missing general capability.

Existing `projects.vite`, `VitePlaygroundPlan` and Playground companion calls remain compatible, optional conveniences over the general platform. Their explicit project intent may name Vite; package compatibility must not depend on using them. Tests, parity oracles, compat docs and templates may name packages. Host build tooling is outside this cleanup.

## User scenario

A user installs the currently supported Vite dependencies and runs build/dev, edits a source file for HMR, then restores/restarts the project. Preserve existing supported behavior in both COI and no-COI paths, including existing loud gaps; package adaptation follows installed dependencies without requiring a Vite helper. Existing applications using the public helpers continue to work.

The user then opens an Express project. Its acquisition, execution, persistence and diagnostics do not inherit Vite policy. A user-owned `.vite/notes.txt` is not hidden merely because of its directory name. Existing supported consumers of other adapted packages retain their supported results as each adaptation moves to registry ownership.

## Invariants

Each target is false on the inspected main baseline `1e91c3df5`; source witnesses below are not behavioral acceptance proof.

1. I1 — Every existing guest-package adaptation has registry ownership; platform production modules contain no independently maintained package versions, integrity constants, patches or startup policy. Current witnesses: Workbench esbuild adapter, Vite preparation and emnapi finalizer.
2. I2 — Generic runtime contracts and realm identity storage have no guest-package-specific API or key. Current witness: runtime-js `RuntimeEsbuildCjsOuter`, `publishRuntimeEsbuild`, `readRuntimeEsbuild` and the `esbuild` slot.
3. I3 — Generic project-file visibility and package diagnostics do not infer Vite ownership from a name. Current witnesses: `.vite` exclusions and `[real-vite/worker]` logs in the captured inventory.

## Challenge

Fresh read-only critic, updated refine process; verdict below verbatim:

> challenge: 2026-09-07 — clear
>
> Ценность следует из исходного требования: существующая совместимость получает одного владельца; платформе перестают требоваться esbuild/Vite/@emnapi-specific контракты. Это архитектурный результат, не доказательство нового функционального исправления.
>
> Минимальный кандидат — конечные registry-owned реализации, собираемые вместе с SDK, с существующими installed-tree bytes и lifecycle. Независимая доставка и публичный plugin API пользователю не нужны. Carrier ещё предстоит проверить.
>
> Альтернативы:
>
> - Перенос констант или переименование edge-модулей недостаточны: `node-entry-runtime-preparation.ts` непосредственно выбирает Vite planner; `workbench-runtime-adapters.ts` самостоятельно проверяет esbuild bytes, запускает клиент и публикует объект.
> - Полный перенос клиента в installed guest package возможен только после отдельного обоснования. ADR-0371:35–38 уже отвергает этот маршрут из-за дополнительного механизма доставки и нарушения data-only catalog. Для выбранного результата он не обязателен.
> - Исправление общей Node-возможности предпочтительно там, где действительно устраняет адаптацию. Однако исходники сами этого не доказывают: `vite-cli-install-policy.ts` меняет guest promise tracking и Chokidar; `emnapi-core-install-policy.ts` содержит точечный upstream backport. Нужен конкретный oracle/probe, прежде чем объявлять общий runtime fix достаточным.
>
> Замечания для FIT:
>
> - Сохранить startup-before-import, exact CJS identity, отсутствие запуска для Vite info, installed-tree/offline authority. Это условия проверки carrier, не новые вопросы пользователю.
> - ADR-0278:613–617 отдельно предписывает исключение `.vite` при экспорте архивов и запрет таких путей при импорте. Учесть при инвентаризации I3 и оформлении ADR-коррекций; сохранение публичных helpers не означает сохранение каждого исторического исключения.
> - Source inventory подтверждает распределённую политику; браузерные симптомы и полная существующая совместимость в этой проверке не воспроизводились.
>
> Нового обязательного user-owned выбора нет. Инвентаризация, carrier, probes и необходимые ADR-коррекции принадлежат агенту.

## Decisions

- 2026-09-07 — user: all existing cases, not only Vite → esbuild; no new-package support promise.
- 2026-09-07 — user: rebuilding the SDK for an adaptation update is acceptable; independent update delivery is not required.
- 2026-09-07 — user: preserve optional public Vite helpers; ordinary package execution must not require them.
- 2026-09-07 — dedup: expand this draft; `preset-deglue` retains its separate user-visible lifecycle/provenance work. No new duplicate epic. Declined concepts and traps checked; no matching rejection of this outcome.
- 2026-09-07 — early premise check clear under PR #315 process; reuse for unchanged promises at FIT/PICKUP. No new user scope choice or implementation authorization inferred.

- 2026-09-07 — FIT: tier works; preserve existing supported results, fault rejection and restore; no additional recovery contract.
- 2026-09-07 — rejected route: constants-only or renamed Workbench edges violates I1; separate executable guest delivery unnecessary for Outcome.
