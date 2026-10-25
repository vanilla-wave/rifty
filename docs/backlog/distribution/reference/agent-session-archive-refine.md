# Agent session archive — refine evidence

## Original input and answers

Original request, 2026-09-29:

> $rifty-refine хочу чтобы история чата агента хранилась в папке в файловой
> системе. Причем по всем сессиям. Чтобы опыт был максимально похож на
> декстопный, где я мог сказать "а вот в прошлых сессиях мы"

Answers, 2026-09-30:

- Folder: «В файловой системе rifty, доступной агенту».
- Retrieval versus UI: «Агент находит и читает прошлые сессии по запросу».
- Project scope initially unclear: «Не понял что значит "текущий проект"
  давай обсудим с примерами».
- Clarifying example 1: reopen the shop and refer to yesterday's shop chat.
  Example 2: open a separate blog and say «Сделай авторизацию как вчера в
  магазине». Asked whether example 2 should work; answer: «второй вариант».
- SDK versus Playground: «sdk и workbench, но если сразу появился в playground,
  то ок».
- Deleting the shop: «История остаётся после удаления проекта».

SDK and Workbench are existing distinct public host paths in ADR-0424:
`createSandboxAgentHost` over `@riftydev/sdk` and `createWorkbenchAgentHost`
over `@riftydev/workbench`. Do not reinterpret SDK as only a Playground helper.

## Baseline and dedup

Inspected HEAD and local origin/main:
`7e695a25059c850e35cca55a64d1e3e472866a3d` (same commit).
No claim that remote main was fetched during this research.

Commands: `git rev-parse HEAD`, `git rev-parse origin/main`; targeted `rg`
for history/transcript/session in backlog goals, distribution/playground items,
`docs/process/traps.md`, `docs/adr/README.md`; reads of the paths below.

- Partial match: `docs/backlog/distribution/ai-ide-product-ui.md` mentions history
  UI. Cross-linked the new archive goal there; no duplicate storage owner.
- `distribution/public-api-ai-agent-contract-snapshot-restore` concerns sandbox
  disk snapshots, not conversations. No matching declined concept or goal found.
- `packages/agent/README.md`, `packages/agent/src/session.ts`, ADR-0466:
  initialMessages restores caller-supplied native history; storage stays host-owned.
- `apps/playground/src/ai/AiChatPanel.tsx`: ensureSession creates without
  initialMessages, endSession disposes; exportSession downloads on explicit action.
  ADR-0427 intentionally owns export-only/ephemeral chat behavior.
- `packages/agent/src/workbench-host.ts`: files read only `session.files`, root `/`.
  `packages/workbench/src/workbench/project-file-boundary.ts`: rejects `..`
  and `/.rifty`; public `/` is project-rooted, not common owner storage.
- `packages/workbench/src/workers/workbench-project-store.ts`: deleteProject
  recursively removes the source project's container. Shared archive access and
  independent lifetime do not exist merely because OPFS persistence exists.
- `packages/agent/src/sandbox-host.ts`: files use `sandbox.project(...)`;
  preview mode omits project file/shell tools. New archive integration must handle
  its actual access/lifecycle, not claim these capabilities already exist.
- ADR-0474 and `packages/agent/src/session.ts`: compaction projects receipts into
  a summary plus a suffix. Working context is not a complete persistent archive.
- `packages/agent/src/tools.ts`: file reads capped at 16 KiB, list at 2000 entries;
  archive discovery/reading needs proof beyond tiny single-session fixtures.

These source observations establish I1–I4 are not delivered on the inspected
baseline. They are not product acceptance proof or an external desktop oracle.

Executed earlier in this refine conversation:
`pnpm exec vitest run --project unit packages/agent/src/history.test.ts`
→ Vitest 2.1.9, 28 tests passed, 1 file passed, 1.31 s.
This proves the existing native restore seam only, not archive behavior.
A later interrupted repeat had no collected result; it is not additional proof.

## Final verification

- Fresh `/root/archive_final_review` checked the actual six-file final set at
  `7790a94de6174aeb03ff79ff1e25c94de495d11a`: Final+GREEN PASS; no unresolved
  user fork. Record: `agent-session-archive-final-green.json` in this directory.
- `pnpm pr:check`: docs-only 20/20 PASS. First sandbox run failed four tsx
  launchers at local IPC `listen EPERM`; repeat outside sandbox passed all 20.
  Skipped source lanes: typecheck, build:libs, build:playground, check:es-floor,
  check:arch, test:run, test:parity. No product behavior proof claimed.
- Post-review edits only flip the goal to ready and record review/check evidence;
  the implementation item stays draft. All four product invariants remain open.

## Scope attribution

| Source | Observable consequence | Authority |
|---|---|---|
| All sessions + rifty folder | automatic file archive, no manual export | original request + round 1 |
| Blog refers to shop | cross-project discovery without old filename/transcript | example 2 accepted |
| SDK and Workbench | reusable public consumers, Playground optional | round 2 exact answer |
| Keep after delete | archive is not owned by source-project lifetime | round 2 exact answer |
| Complete history vs compaction/reset | preserve original records outside shrinking context | all sessions; ADR-0474 is context only |
| Existing local storage | scope shared local archive, not other devices/apps | no sync request; host-owned storage ADR-0466 |
| Existing project archive API | import/export does not move global conversations | existing project-rooted baseline; no migration request |
| Desktop-like persistence | acknowledged records survive reload/interruption | agent-selected production tier, FIT step 4 |

## Premise challenge

Read-only critic `/root/history_premise`, fresh initial context; early verdicts
identified filesystem/project scope, then public-consumer/deletion scope. Each
returned to the user and is resolved by the exact answers above.
Final critic verdict verbatim:

> challenge: 2026-09-30 — clear
>
> Ответы пользователя закрыли найденные развилки: ФС rifty; поиск по запросу между проектами; «sdk и workbench, но если сразу появился в playground, то ок»; «История остаётся после удаления проекта».
>
> Ценность следует из сценария: новая сессия может найти исходный разговор другого проекта, включая удалённый. Минимальный путь — автоматически сохраняемый общий архив, доступный агенту как файлы. Восстановление последнего контекста и ручной экспорт этого не обеспечивают. UI продолжения, облачная синхронизация и загрузка всего архива в контекст не нужны.
>
> Существующие границы учтены:
> - `packages/agent/README.md`, ADR-0466: хранение принадлежит хосту; `initialMessages` решает восстановление контекста, не межсессионный архив.
> - `packages/agent/src/workbench-host.ts:44`, `packages/workbench/src/workbench/project-file-boundary.ts:91`: файловые инструменты ограничены проектом. Общий владелец архива и публичный путь доступа — обязательная техническая подготовка, не готовый механизм.
> - `packages/workbench/src/workers/workbench-project-store.ts:222`: удаление проекта удаляет его контейнер; архив обязан переживать эту операцию согласно ответу пользователя.
> - ADR-0427: export-only политика требует явного пересмотра. ADR-0474: сокращаемая проекция контекста не заменяет полный архив.
>
> SDK + Workbench — обязательный результат; Playground допустим как ранний потребитель, не условие завершения. Production-доказательство проверяет уже принятые к сохранению сообщения после reload/crash; границу подтверждения записи следует определить техническим контрактом. Восстановление никогда не сохранённых разговоров, перенос между устройствами и сохранность после уничтожения браузерного хранилища из принятого сценария не следуют.
>
> Новых материальных пользовательских развилок по проверенным взаимодействиям не найдено. Проверка предпосылки read-only; реализация не проверялась.
