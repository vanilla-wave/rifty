# Agent code quality eval — refine evidence

2026-09-15; baseline `51440931aeb5e322ddfcab930e02068e7083922e` (HEAD and
local origin/main); branch `t3code/sandbox-agent-eval-infrastructure`.
Research only: no new model trials or product implementation.

## Original request and answers

User: «недавно сделали эпик про ai агента. Теперь хочу почти дальше по плану
и сделать инфру для eval чтобы убедиться что агент в песочнице генерирует
насколько же качественный код что и в обычной среде»; invoked `rifty-refine`.

Round 1:

- 1.1: «2 + для референса codex». Option 2 was Rifty agent versus ordinary
  native Pi CLI with the same model. Codex is an additional reference.
- 1.2: «1 + 2». Options: bugs/features in several real JS/TS projects;
  applications created from a description.
- 1.3: «Решает задачу, проходит проверки, не ломает существующее
  (рекомендую для v1)».
- 1.4: «Повторяемый эксперимент и отчёт: разница, неопределённость,
  причины провалов (рекомендую)».
- 1.5: «Основной результат — работает ли решение в среде, где агент его написал».

Round 2:

- 2.1: «Основной результат — работает ли решение в своей среде».
- 2.2: «2, но стартеры разные». Option 2 was a minimal starter with installed
  dependencies; applications start from multiple distinct starters, not an
  empty directory. User reconfirmed both answers in the final message.

## Dedup and baseline

Read `docs/process/README.md`, backlog README/readiness/FIT, fault taxonomy,
`docs/ROADMAP.md` M12, ADR index Declined concepts and process traps.
Project-local searches for agent/bench/eval across backlog titles, maps,
sources and code found the delivered `tools/agent-bench`, no live duplicate
of this expanded outcome. `open-bolt-ai-sandbox-demo` is a public demo,
not comparative evaluation; M12 UI/subagent items are separate outcomes.

`docs/adr/distribution/0434-run-a-three-lane-pi-benchmark-with-shared-profile-and-native-judges.md`
owns the existing diagnostic: actual COI +chat, packed no-COI SDK, native
Pi CLI; shared policy, honest tool/context differences, on-demand runs.
`docs/backlog/distribution/reference/ai-agent-mode-closure-evidence.md`
records the preceding epic's closure.

Current `tools/agent-bench/src/tasks.ts` hardcodes five tasks from two
existing React/Hono templates. `lanes/types.ts` declares only rifty,
rifty-no-coi and local-reference. `runner.ts` judges each lane's preview;
`report.ts` produces per-task pass proportions/deltas, no uncertainty
estimate. Common judges, repeated cold trials and artifact retention already
exist; they are reusable baseline, not new epic deliverables.

## Executed artifact probe

Node `v24.16.0`; executed `node --input-type=module` to JSON-parse
`tools/agent-bench/reports/summaries/2026-09-13-gpt-5.6-sol/{original-report,report}.json`
and gunzip/parse `source-artifacts.json.gz` using `node:fs`/`node:zlib`.
Counted each lane's runs and `outcome === 'pass'`; extracted
`before['package-lock.json'].packages['node_modules/react'].version`
from each `fix-date-sort/<lane>/1` artifact.

```text
original: rifty 14/15; rifty-no-coi 12/12; local-reference 12/15 = 38/42
rechecked: rifty 15/15; rifty-no-coi 12/12; local-reference 15/15 = 42/42
source-artifacts: 42 records with id/trace/before/after
React: rifty 19.3.0; rifty-no-coi 19.3.0; local-reference 19.2.8
Vite: 7.3.6 in all three inspected artifacts
```

This verifies retained records, not newly executed agent behavior. Four judge
repairs and same-source rechecks are documented in that report's README.
No claim that the tasks or samples prove equal quality.

## Codex CLI probe

Executed `codex --version` and `codex exec --help`, exit 0:

```text
codex-cli 0.154.0
--json: Print events to stdout as JSONL
--ephemeral: Run without persisting session files to disk
--ignore-user-config: Do not load config.toml; auth still uses CODEX_HOME
--cd <DIR>; --model <MODEL>; --sandbox <SANDBOX_MODE>
--output-last-message <FILE>
```

Both commands warned PATH aliases could not be created (Operation not
permitted). Help/version succeeded. No provider request, event-schema,
tool-budget, context-isolation or actual artifact-generation proof yet;
those require a discriminating PICKUP probe. No env inspection performed.

## External evidence

- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
  (2026-01-09; read 2026-09-15): distinguish tasks/trials, final outcomes and
  traces; functional tests and calibrated qualitative graders measure
  different properties. Stable environments and isolated trials matter.
- [SWE-bench Multilingual](https://www.swebench.com/multilingual.html)
  (read 2026-09-15): real JS/TS issue tasks exist; evaluation checks both
  fail-to-pass and pass-to-pass tests. Docker-based reference execution is
  not proof of Rifty compatibility. Corpus adoption remains agent research;
  user selected task categories, not this dataset.

## Early Challenge

Fresh read-only reviewer `/root/eval_premise`, before round-1 answers:

```text
Challenge — 2026-09-15: 2 problems
1. Новая eval-платформа пока не обоснована. Текущий agent-bench уже имеет
   три среды, общие поведенческие judges, холодные workspace, повторы,
   артефакты, лимиты и native delta. Дешёвый путь — добавить нужные задачи
   и недостающий вывод в существующий harness.
2. «Качество одинаковое» пока не имеет проверяемого смысла. Аудит имеющихся
   42 запусков дал 42 PASS; пять задач достигли потолка, а инструменты,
   контекст и зависимости различаются. Нельзя обещать положительный вердикт;
   допустим отрицательный либо недостаточность данных.
```

Excerpt; full original reviewer response remains in the conversation.
Resolution: reuse bench; user's 1.1/1.3/1.4 choose practical comparison,
functional quality and report with uncertainty. New Codex/workload scope
sent to fresh `/root/eval_scope_challenge`; final written-result review
still required after scope answers and actual goal/map/children are written.

Fresh read-only reviewer `/root/eval_scope_challenge`, after round-1 answers;
verbatim verdict (relative source links expanded only):

```text
challenge: 2026-09-15 — clear

Расширение существующего tools/agent-bench достигает выбранного результата
дешевле новой eval-платформы: уже есть холодные запуски, native Pi, общие
проверки, артефакты и диагностический отчёт (README, ADR-0434). Новая
ценность — задачи нескольких реальных проектов и создания приложений,
Codex как отдельный референс, оценка функциональности и регрессий.

Прежние 42 успешных артефакта равенство качества не доказывают: корпус мал,
четыре исходных провала вызваны судьями, инструменты/контекст/зависимости
различались (отчёт). Выбранный диагностический результат честнее обещания
равенства; Codex с собственной моделью/конфигурацией не изолирует влияние
песочницы.

Новых материальных пользовательских развилок сверх текущих вопросов о
среде проверки и начальном состоянии greenfield не найдено. До ответов
scope не закрыт. Конкретный корпус и технический способ подключения
Codex — работа агента; exec --help не доказывает живой запуск.

При формализации сохранить различие между заранее объявленным покрытием
корпуса и наблюдаемым сбоем выбранного запуска: setup/runtime failure не
должен исчезать из отчёта или становиться успешной оценкой кода. Основание —
уже принятая честная диагностика и сохранение стадий ошибок (runner,
ADR-0434 §5–6).
```

Sources: `tools/agent-bench/README.md`, ADR-0434 above,
`tools/agent-bench/reports/summaries/2026-09-13-gpt-5.6-sol/README.md`,
`tools/agent-bench/src/runner.ts`. Reflow and code/link formatting normalized;
wording retained. This is a premise check, not final draft review.


## Scope closure (RDY-6)

| Source | Observable consequence | Authority |
|---|---|---|
| 1.1 | Pi and Rifty use the same model; Codex is a separately labelled native reference, with its actual model/config | user |
| ADR-0434 | Preserve both actual COI +chat and packed no-COI paths and their explicit capability differences | existing baseline; agent applies it to extended bench |
| 1.2 | Bugs/features in multiple real JS/TS projects and building apps from descriptions | user |
| 2.2 | Multiple minimal starters with installed dependencies; no empty-project promise | user |
| 1.3 + 2.1 | Functional requirements and regressions judged in the originating environment; passing elsewhere cannot rescue a failed lane | user |
| 1.4 | Reusable report with differences, uncertainty and evidenced failure causes; no automatic merge gate | user |
| Same scenario repeated / settings changed | Each report identifies task/starter/dependency/judge and agent/model/config versions; independent attempts and original failures remain visible | agent inference necessary for repeatable comparison |
| Setup/install/provider/judge failure | Selected trial remains a visible unsuccessful or unevaluable row; failure cause is not guessed from lane identity | diagnostic outcome + existing stage/error baseline |
| Finite goal | Ship reusable infrastructure and a real reference experiment; a negative/inconclusive result closes measurement, not runtime repairs | agent interpretation of eval-infrastructure request |

No automatic claim of causal environment isolation. Codex's own model/config is
recorded rather than forced to equal Pi; the user requested it as a reference.
Corpus selection, Codex execution protocol and uncertainty calculation are
agent-owned implementation research. Existing secrets handling and on-demand
execution remain ADR-0434 obligations. No product implementation authorized by
this refine-only hand-off.

## Final written-result review and checks

Fresh read-only reviewer `/root/eval_refine_final`: PASS, original request and
answers compared with goal/map/three children/evidence and ROADMAP. Verdict:
`agent-code-quality-refine-final-green.json`. No product acceptance certified;
I1–I5 remain future obligations.

Driver matched every supplied SHA256 to commit
`61199dcf9fcca366e4504328fc1f0cc0a7eb7fbf`; goal differs only by the explicitly
permitted `status: draft` → `ready` flip. Reviewed manifest:

```text
65108b0cc27afde51d1820172c43d8c15b9e565bd58e7510e6e6b5a3d8fce5ef  docs/ROADMAP.md
7e713496b1372d30c8df2d62bff29020ec2bb026dceb02baa88e8731dd75f0ed  docs/backlog/epics/agent-code-quality-evaluation/goal.md
aeb69eddb62d254f0c07fb3aa3c91d639557837bba0f7721cfe5d68697f31881  docs/backlog/epics/agent-code-quality-evaluation/map.md
77cfb5c3767eef8e0dc18a3f938e2ae8dfa0dffc6672e485ca89e56c146fe8cc  docs/backlog/epics/agent-code-quality-evaluation/ledger.md
4c26b6ff999185cc406f56b48b1a472d5d2618eac010c57c2cf7d2f549221aa9  docs/backlog/distribution/agent-eval-codex-reference.md
476d965bbcdbedea59c6181229f90e1f94dcc1c2b835ddb25dae4cee332c1686  docs/backlog/distribution/agent-eval-project-corpus.md
5a43098d098a35afddd5fbe1f8e335b906cc3f78a5fecfd5661ea831fe0ae518  docs/backlog/distribution/agent-eval-comparison-report.md
624824586964258aa8b1acd848d2a61902e9c0a2e99950bdd02b19691b7d14b5  docs/backlog/distribution/reference/agent-code-quality-refine-evidence.md
```

- `pnpm pr:check`: docs-only 20/20 PASS, final log
  `/tmp/rifty-agent-eval-refine-pr-check-final.log` (ROADMAP included).
- Initial sandbox attempt: four tsx drift checks failed to start, `listen EPERM`
  for a local IPC pipe; authorized rerun passed. Not a product regression.
- Classifier skipped `typecheck`, `build:libs`, `check:arch`, `test:run`,
  `test:parity`; no source behavior changed or tested here.
- `pnpm backlog:check`: 307 items, 16 epics, 0 invalid; repeated after ready flip.
- `pnpm refs:check`: 284 ADRs, 616 source docs, PASS; `git diff --check` PASS.

## Corpus discussion

Source: conversation after PR #341 refinement, 2026-09-15.

User: «Можем детальнее обсудить набор тестов? Хочу понимать что там будет
и как соберем набор кейсов. Не хочется скатиться в тривиальный набор».

Driver proposal, decisive original excerpts:

- «Начать с шести разных кандидатных задач — по две каждого типа.
  Проверить их качество, затем расширить корпус примерно до 20–30.
  Число пока ориентир».
- «Разные стартеры должны давать разные рабочие сценарии. Восемь одинаковых
  CRUD-форм на разных фреймворках дают мало дополнительной информации».
- «Текущие пять простых задач сохраняем как отдельные быстрые проверки регрессий».
- «Скрыты тестовые данные и проверки, но не требования».
- «Корпус фиксируем до итогового сравнения. Провалы Rifty из него не удаляем».
- «Эталонное решение проверяем в каждой среде: это помогает увидеть
  ограничения среды. Основной результат остаётся выбранным тобой —
  работает ли решение именно там».
- «Для распределения корпуса я бы предложил примерно ⅔ приложений и ⅓
  Node API, CLI и библиотек. Тебе ближе такой акцент или почти весь набор
  должен представлять создание веб-приложений?»

The same proposal described real issue/pre-change snapshots for bugs/features,
original product workflows for starter apps, per-case provenance/requirements/
regressions/reference/checks/difficulty, failing baseline and partial-solution
controls, accepting other working implementations, pilot trajectory review,
family-separated calibration/evaluation and separately counted trials.
Its six illustrative scenarios are retained in the corpus child's candidate
table; no concrete repository or exact task was claimed selected.

User reply: «выглядит ок. А как это в эпик положим?».

Interpretation: accept the proposed corpus-building direction; amend scenario 1
and I6/I7 to make substantive cases, validated checks and selection integrity
reviewable obligations. Six pilot candidates / roughly 20–30 scored cases are
route estimates. The approximate two-thirds split remains an agent curation
guide, not an exact user quota or an exclusion of other accepted JS/TS workflows.
No model runs, source changes or implementation authorization added.

### Premise critique

Fresh read-only `/root/corpus_challenge`, before the accepted proposal; verbatim
wording, Markdown/source formatting normalized:

> Вердикт: направление годится; 24 задачи сами по себе от тривиальности не защищают.
>
> - Риск однообразия. Предложенные сценарии преимущественно UI CRUD. Нужны также реальные библиотечные/CLI задачи и изменение существующего API: чужая структура проекта, поиск причины, совместимость вызовов. Иначе несколько репозиториев могут оказаться одним упражнением в разных декорациях. Сейчас 4/5 задач используют один React-шаблон — tools/agent-bench/src/tasks.ts.
> - Сложность — связанный сценарий. Для приложения важно явно выбрать: законченный пользовательский процесс или несколько независимых экранов. Например, импорт → исправление ошибок → сохранение → фильтрация → экспорт; проверяется согласованность данных между шагами. Восемь отдельных форм создания мало добавят.
> - Судья может навязывать реализацию. Текущие проверки завязаны на .issue-card, .issue-card__id и конкретные подписи — src/judge/context.ts, tasks/new-issue-form/judge.ts. Для существующего UI это допустимо; перенос на свободное создание приложений превратит скрытые проверки в скрытые требования. Контракт должен определять поведение и необходимые точки взаимодействия; судья принимать разные корректные реализации.
> - Native reference недостаточно для причин. Один раз прогнать эталонное решение в каждой среде: иначе нельзя отличить неспособность агента от принципиально неработающего там проекта. Ограничения уже наблюдались: Vitest/esbuild и политика установки — agent-bench-baseline-results.md. Такие выбранные задачи сохраняются в общем результате; дополнительный срез совместимых задач должен иметь заранее определённое правило.
> - Holdout разделять по семействам. Соседние задачи одного репозитория или вариации одного starter-сценария легко передают решения из калибровки. Публичный issue/pre-fix snapshot также не гарантирует отсутствия обучающего загрязнения; свежие оригинальные сценарии дополняют его, но не доказывают чистоту.
>
> Проще: сначала шесть кандидатных задач — по две каждого типа, максимально разных. На них проверить пригодность исходников, эталоны и строгость судей; затем расширять покрытие пробелов до окончательного числа. Считать независимыми единицами задачи/семейства, а повторные запуски — измерением нестабильности агента. Не отбирать задачи по тому, где Rifty проходит.

Reception: distinct scenarios replace the earlier UI-heavy examples; pilot
precedes expansion; I6/I7 carry behavior-based judging, all-environment reference
controls and selection integrity. The critique's 24 was an earlier working
count, superseded by the proposal's explicit 20–30 estimate. Existing code and
baseline evidence support its observations; no new runtime probe claimed.

### Corpus amendment review

Fresh read-only `/root/corpus_amendment_final`: PASS, no findings.
Record: `agent-code-quality-corpus-final-green.json`; reviewed commit
`ec3ba65a60d131b741d445a4f6bfe2d6b0831e2d`. Driver verified all six reviewed SHA256 hashes.
I1–I5 preserved; I6/I7 accepted; counts/mix remain estimates.
Documentation only; I1–I7 implementation and live proof remain open.

`pnpm pr:check`: docs-only 20/20 PASS; log
`/tmp/rifty-agent-eval-corpus-pr-check.log`. Source lanes skipped;
`git diff --check` and verdict validator PASS.

```text
8ef58e991c4d149b3167b917ff87cf28d9fc95382a86ac4cee9c0bd1bde31f3f  docs/backlog/epics/agent-code-quality-evaluation/goal.md
dde905965cccafec8adac6ad62b1eaa1c8ff096298758e81a2ddf61b66fea946  docs/backlog/epics/agent-code-quality-evaluation/map.md
3d3d86416652dc808866a66470d51cb35b3598c796e0c80f1c4f300bf21166a9  docs/backlog/epics/agent-code-quality-evaluation/ledger.md
31545bbb349fa25f93acf8701e71f5ae59e3a4e48515fd46228585871dc3da92  docs/backlog/distribution/agent-eval-project-corpus.md
2b4a03d4ff811c7e8c62db1d0ea33e86085903f4291852aaad3928580a95b09d  docs/backlog/distribution/agent-eval-comparison-report.md
2fd35ba304cfb0056530006c0ce562ca86a6615759b93e2d0ad5b6add82e71ae  docs/backlog/distribution/reference/agent-code-quality-refine-evidence.md
```

## PR review amendment

Source: PR #341 review, 2026-09-15. User: «Глянь что думаешь про
https://github.com/vanilla-wave/rifty/pull/341»; after the findings: «Внеси
правки. И я не понял что предлагаешь с кейсами делать?». Findings verified
against the branch and `main` sources; no model runs.

- Judges are preview-only. `tools/agent-bench/src/judge/context.ts` gives a
  judge `previewUrl` + `view`; all five task judges evaluate DOM/HTTP of the
  resident preview. No lane executes a test suite or CLI as a judge; the COI
  lane exposes seed/export/metadata hooks only (ADR-0434 §2); Vitest 2.1.9
  install is rejected in Rifty (legacy-esbuild ceiling,
  `agent-bench-baseline-results.md`). Real-project bug/feature and CLI/library
  cases judged in their own environment need a command-result judge per lane;
  the goal only implied this under "unsupported capability stays visible".
  → map open question; corpus route step 1 (substrate probe) gates curation.
- Campaign size unrecorded: roughly 20–30 cases × 4 environments × 3 trials
  ≈ 240–360 live runs plus reference solutions per environment; the 2026-09-13
  diagnostic shows 62–83 s median agent time, tails 329–541 s, before cold
  real-project install. → map open question; report item records matrix,
  expected runs, wall-clock and usage before a campaign; I5 closes on the
  validated pilot corpus, expansion is a follow-up slice.
- Case authoring is the main cost driver: snapshot, lockfile, reference
  solution, plausible-partial control, judge controls, patch-leak scrub and
  four-environment reference runs per case. → map paragraph; route step 6
  records per-case cost.
- Starting state: prior lanes resolved React 19.3.0 vs 19.2.8 from the same
  semver; the goal required "comparable"/"recorded" only. Rifty npm-client
  reads package-lock v3 (`packages/npm-client/src/installer-lockfile-reader.ts`,
  ADR-0023); the native lane runs plain `npm install`. → I1 requires one
  pinned lockfile installed by every lane; case card carries the per-lane
  install result.

Interpretation: «Внеси правки» authorizes applying the four findings. The
case question was answered in the same session: I5 closes on the six-case
pilot, frozen and family-split under I7; expansion is a later slice; the
judge-substrate probe precedes curation, and a lane whose runner cannot run
is recorded unsupported for that case up front; one lockfile per case; case
authoring cost is measured in the pilot. No user reply to that answer yet;
if the user rejects it, route step 1 and the I5 pilot clause revert and the
rest of the amendment stands.

Unchanged: I2–I4, I6–I7 wording, scenario, out-of-scope, children's `draft`
status, ROADMAP. Documentation only; I1–I7 implementation stays open.

### PR review amendment check

Fresh read-only reviewer over the uncommitted amendment; verbatim verdict
(Markdown/source formatting normalized):

```text
challenge: 2026-09-15 — 4 problems

- goal.md I5 «pilot corpus can close it» vs I7 «expanded, versioned
  evaluation corpus … fixed before the comparative campaign» и corpus шаг 7:
  не сказано, что freeze/family-split применяется к версии пилота и несёт ли
  расширение свою кампанию.
- map.md «prior medians 60–80 s … tails to 540 s» расходится с README
  2026-09-13 (62.2/82.9/62.9 s; 541.1 s) и evidence («62–83 s, 329–541 s»).
- evidence фиксирует вопрос пользователя про кейсы, но не ответ/интерпретацию;
  решение по кейсам опирается на «Внеси правки» при заявленном непонимании
  именно этой части. Добавить Interpretation (RDY-6).
- Стиль: corpus незавёрнутая строка 123 символа; goal.md I1 сирота
  «checked judges».

Проверено: judge/context.ts:2-5, tasks.ts:29, ADR-0434:18-19,
baseline-results:16, installer-lockfile-reader.ts:31-35,
lanes/local-reference.ts:25, README 2026-09-13:46-48, 240–360 = 20–30×4×3.
Нумерация route 1–7 сплошная; ссылки и amend-строка согласованы; I2–I4,
I6–I7, решения 1.1–2.2, статусы draft детей не тронуты; новых механизмов
не введено.
```

All four applied before commit: I5 and route step 6 bind the pilot campaign
to the version frozen and family-split under I7/step 7 and give expansion its
own campaign; map numbers now match the 2026-09-13 README; Interpretation
added above; both wraps fixed. Factual verification of the findings stands.

- `pnpm pr:check` after the fixes: docs-only 20/20 PASS, log
  `/tmp/rifty-pr341-review-amend-pr-check.log`; source lanes skipped.
- `git diff --check` PASS.

## Local script execution

User asked why launch workflow was not discussed, then selected:
«На машине с использованием codex».

Driver clarification: «Правильно понимаю: ты открываешь репозиторий в Codex,
пишешь „запусти eval …“, а Codex сам запускает локальную серию, следит за
прогрессом и разбирает отчёт? Native Codex при этом остаётся отдельным
участником сравнения».

User: «Это точка входа. Но как будто нужен набор скриптов, которые будут
детерменированное все это запускать».

Driver's separate interruption question offered continuation without repeating
completed trials versus retaining a partial report and starting a new series.
User: «Сохранить частичный отчёт; следующий запуск — новая серия».

Interpretation: Codex is the local operator; repository scripts own the
repeatable experiment protocol and scoring. Native Codex remains a separate
evaluated process. Operator text is not a score oracle. Fixed configuration
determines the matrix and controlled inputs/order; model outputs, timings
and runtime scheduling remain variable. Interruption preserves persisted
completed results, exposes unfinished work, and never resumes implicitly.
The next run uses fresh workspaces and separate output. Explicit old-path
reuse rejects rather than overwrites. These are I8/I9 and scenario 2/6;
no automatic continuation or whole-goal implementation was authorized.

Current source at `6f3ecb34939fc700073558555af681ca1380ee13`:
`tools/agent-bench/src/cli.ts` exposes run/report, no resume command;
`config.ts` records endpoint/model, limits, repeats and playground port;
`runner.ts` loops tasks/lanes/repeats, prints START/END and persists each
completed record, but initializes an empty report and uses recursive mkdir
on the requested output path. `report.ts` regenerates JSON/Markdown from
stored report.json without model calls. These are source observations, not
an executed interruption or local-Codex acceptance test.

Route: first extend that existing CLI/runner on one existing task, then add
the Codex reference and corpus; comparison report reuses the same series
records. No second scheduler, service or model-driven run orchestrator is
required. Changed public seams or new mechanisms still follow PICKUP/ADR
and the existing fault-class inventory; no mechanism is prescribed here.
