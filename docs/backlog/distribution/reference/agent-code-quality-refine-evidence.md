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
