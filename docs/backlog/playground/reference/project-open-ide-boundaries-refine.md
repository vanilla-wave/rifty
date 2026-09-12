# Project open and IDE dirty — refine evidence

2026-09-10; inspected source `e5122ed5f39ecf4eb411419b03c390306d381ebc`
(current branch adds documentation only). This records preparation, not a repair.

## Original user input and answer

User, after the FS dirty-stamp assessment/explainer:

> мне не нравится механизм проверки снжпшота. Этого нет в node мире. Никто не проверяет пр иоткрытии проекта что с файлами все ок. Как будто проверка должна остаться на уровне "не сломано"
>
> dirty черновика как будто фича про ide и не должна протекать в другие уровни

The user requested a concrete example. Driver's exact scenario:

> 1. Есть сохранённый Vite-проект, созданный из snapshot. Он уже работал.
> 2. Ты запускаешь в терминале `npm install lodash`.
> 3. Установка начала менять `node_modules`, но ты закрываешь вкладку до завершения.
> 4. Открываешь проект снова. Исходники сохранились, установка зависимостей могла остаться неполной.
>
> Сейчас по коду: Rifty не находит подтверждения завершённой установки и отказывает в открытии всего проекта.
>
> Предлагаемое поведение: проект открывается, исходники доступны для редактирования, терминал доступен. Если запустить программу, которой не хватает пакета, она выдаст соответствующую ошибку. Ты можешь вручную закончить установку через `npm install`.
>
> То есть незавершённая установка пакетов не должна лишать доступа к исходникам и терминалу. Именно об этом сценарии был вопрос.

User: **«да, ок, ровно поведение node»**.

The answer selects that observable reopen behavior. It does not authorize a
new meaning of dirty, automatic install, unsupported browser execution, partial
recovery of unreadable storage, or a particular implementation mechanism.

## Executed native probe

This proves local Node execution does not require a globally consistent install.
It does not execute npm, interrupt an install, launch Vite, or prove browser UI.

```sh
node --input-type=module <<'JS'
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const root = mkdtempSync('/tmp/rifty-native-open-boundary-');
writeFileSync(root+'/package.json',JSON.stringify({name:'open-boundary-probe',private:true,dependencies:{'rifty-probe-package-never-installed':'1.0.0'}}));
writeFileSync(root+'/package-lock.json','not valid JSON');
writeFileSync(root+'/main.cjs',"console.log('existing local source ran')\n");
writeFileSync(root+'/missing.cjs',"require('rifty-probe-package-never-installed')\n");
const runnable=execFileSync(process.execPath,[root+'/main.cjs'],{encoding:'utf8'}).trim();
const missing=spawnSync(process.execPath,[root+'/missing.cjs'],{encoding:'utf8'});
console.log(JSON.stringify({node:process.version,root,manifestListsMissingPackage:true,lockfile:'invalid JSON',localSource:runnable,missingRequireExit:missing.status,missingRequireError:missing.stderr.includes('MODULE_NOT_FOUND')?'MODULE_NOT_FOUND':missing.stderr}));
JS
```

Exit 0 on 2026-09-10; exact output:

```json
{"node":"v24.16.0","root":"/tmp/rifty-native-open-boundary-YzO7Kh","manifestListsMissingPackage":true,"lockfile":"invalid JSON","localSource":"existing local source ran","missingRequireExit":1,"missingRequireError":"MODULE_NOT_FOUND"}
```

## Source → consequence → authority

| Source | Consequence | Authority / disposition |
|---|---|---|
| `package-acquisition-authority.ts:717` | saved snapshot open refuses when trust is absent/pending/incompatible | user explicitly changes this result; ADR-0394 conflict must be superseded before implementation |
| same file `:949` | manifest mutation can retain live owner-runtime readiness | source evidence for live/reopen asymmetry, not browser reproduction |
| same file `:565`, `:978` | child admission requires published runtime state; lock supplies shadow bindings | remove neither capability validation nor real execution; deleting the open guard alone is insufficient |
| `playground-project-authority.ts:1474` | startup recovers own interrupted transaction | retained storage baseline, distinct from revalidating user package contents |
| `workbench-project-vfs.ts:519`; `owner-package-state.ts:742` | generic file/package handling contains Scratch-specific classification | user's IDE-ownership direction; preserve existing generated/cache exclusions |
| ADR-0278/0307; guest/npm/Git callbacks | off-editor mutations affect companion state | ownership change is not editor-only tracking or a new definition of dirty |
| accepted Vite/lodash scenario | open files/terminal; no implicit install; point-of-use failure | exact user confirmation above; implementation and crash parity still unproven |

Code paths above are under `packages/workbench/src/workers/`.

## Challenge

Fresh read-only critic `/root/review_open_boundary`, before user confirmation:

> Направление обосновано; две оговорки: child runtime всё ещё зависит от install trust, а recovery собственных транзакций нужен при mount.

Verified findings: live/reopen asymmetry; child readiness/shadow bindings need a
real reconstruction path; catalog recovery stays at mount; dirty ownership
must include off-editor writes. No cheaper direct route was established: dropping
one saved-open guard merely moves failure to child admission. Raw source citations
and the dispositions are in the table above.

Critic's remaining scope observation:

> Оставшаяся смысловая развилка dirty: «любое отличие черновика» или «изменение значимых для IDE файлов с исключением generated/cache». Передача владения сама её не решает.

Disposition: baseline-preserving ownership only, not a new dirty definition;
ADR-0278/0307 settle the exclusions. The readable-partial-install branch was
resolved by the user's concrete answer. Unreadable storage retains its existing
loud failure; own interrupted transactions retain recovery. No extra user fork
is asserted settled through a newly invented exclusion.

## Dedup and delivery boundary

- Reuse `playground/install-stamp-invalidation`: same reopen/trust boundary;
  its stale tree-surveillance direction is replaced by the user's current one.
- Existing `playground/reload-crash-consistency-fault-e2e` and its OPFS epic
  promised automatic install after reload; record the user's amendment there.
- No matching dirty-ownership item in backlog/maps/traps/declined concepts.
  `scratch-reset-keeps-page-dirty` remains the narrower observed defect.
- Imported-project run-plan concerns UI selection for imported programs; Vite 8
  cross-build predecessor concerns a different runtime-policy transition. Neither
  substitutes for the accepted interrupted-install scenario. Their unrelated
  promises are not rewritten by this capture.
- No implementation requested in the discussion; drafts require pickup,
  applicable ADR decisions and discriminating real-product proof before repair.
