# Environment differences and capability boundaries — refine

2026-09-27; source baseline `0e4dd0e31`. No new model trial or browser-host
acceptance run. This extends the existing ready goal, not a runtime repair.

## User source

«Ок. Но еще хотелось бы две вещи
- найти странности/отличия. Например сходу кажется что агенты могут звать
  python, которого у нас нет. Хочется найти список таких мест
- найти ceil для rifty. Не хочется взять 10 простых сценариев и убедиться
  что и там и там все ок».

Prior accepted scope: practical Rifty/native Pi comparison with the same model,
native Codex reference, own-environment functional success, honest uncertainty,
diverse JS/TS tasks, local scripts, partial report/new series on interruption.
Prior I5 permits the validated pilot to close the reference-campaign clause;
it does not discharge new I10/I11 difference/boundary obligations.

## Baseline and dedup

Existing `tools/agent-bench/tests/baseline-probes.ts` and
`agent-bench-baseline-results.md` cover selected commands/toolchain questions;
`tools/agent-bench/src/report.ts` records per-task deltas and manual failure classes. Retained
traces already carry actual tool inputs/results. Existing corpus/report drafts
cover nontrivial cases but prescribe no graded-boundary search or operation
catalog. Extend that owner; no duplicate eval engine or runtime-feature epic.

`packages/agent/src/prompt.ts` already warns that Rifty lacks a full system
shell/native binaries. Absence of a command in observed calls therefore does
not establish that agents would never need it. Ordinary prompt/tool differences
remain visible under ADR-0434; no new prompt intervention is assumed.

## Executed probe

Node `v24.16.0`, `node --import tsx /tmp/rifty-eval-capability-probe.mjs`.
The scratch probe imports the real Shell public entry and real MemoryFsSync,
creates only `/work`, supplies that filesystem to Shell and calls `run()` on
the five commands below. No fake commands, installed bins or host registration.

Replay from repository root: `node --import tsx --input-type=module` with
this stdin (same source imports and operations as the executed scratch file):

```js
import { Shell } from './packages/shell/src/index.ts';
import { MemoryFsSync } from './packages/vfs/src/internal/index.ts';
const memory = new MemoryFsSync();
memory.mkdirSync('/work', { recursive: true });
const shell = new Shell({ cwd: '/work', fileSystem: memory });
for (const command of ['python3 --version', 'python --version',
  'sed -n 1p file.txt', 'curl --version', 'jq --version']) {
  const { exitCode, stdout, stderr } = await shell.run(command);
  console.log({ command, exitCode, stdout, stderr });
}
```

All five: exit127, empty stdout, `<command>: command not found\n` stderr.
Raw selected evidence: `agent-eval-capability-probe.json`. Scope is standalone
Shell; no claim that both public browser hosts or arbitrary installed projects
were exercised. Initial scratch import used nonexistent `vfs/src/internal.ts`;
it failed before execution. Corrected to the actual internal entry and reran;
that setup error is not a product RED or a compatibility finding.

The same Node probe gunzips/parses
`tools/agent-bench/reports/summaries/2026-09-13-gpt-5.6-sol/source-artifacts.json.gz`.
For browser rows it reads `trace.transcript`; native rows use the last
`agent_end.messages`. It visits assistant `toolCall` blocks named shell/bash,
deduplicates call IDs per run and matches candidate tokens in command strings:

```js
new RegExp(`(?:^|[\\s;&|])${token}(?:[\\s;|&]|$)`).test(command)
```

This is heuristic candidate discovery, not a shell parser or proof that every
matched token was executed. Native candidates include sed18/curl6; no Python
candidate in these 42 old runs. Absence is limited to this scan and corpus.
Selected exact native calls, linked to their recorded tool results:

- `fix-date-sort/local-reference/1`, `call_64MShTJQs9CvUykmoC4VDcLb`:
  `ls -la && find . -maxdepth 2 -type f | sort | sed -n '1,200p'`; successful
  tool result contains project listing.
- `new-issue-form/local-reference/2`, `call_NSi9xIY9HhRagKKXcDtq8i5T`:
  curl to its local preview followed by head; successful result contains HTML.
- `node-endpoint/local-reference/3`, `call_cF7hAvvfbYAJ9ZXaEoPu17Tt`:
  curl to its local API; exit7 connection refused. This is a reached curl
  executable with a failed request, not an absent curl command.

Retained original report identifies Pi0.85.1/Node24.16.0/Chromium148 and
gpt-5.6-sol. This session inspected artifacts; it did not rerun those trials.

## Challenge

Fresh read-only `/root/ceiling_premise`; verdict wording preserved:

challenge: 2026-09-27 — clear

> Направление отвечает запросу. Нужны два результата: каталог реальных различий среды и систематический поиск границ на содержательных JS/TS-задачах.
>
> Дешевле: расширить существующие retained traces и tests/baseline-probes.ts; затем добавить ступени сложности в текущий corpus/report. Отдельная eval-платформа, универсальный shell-parser и автоматическая реализация Python ценности здесь не добавляют.
>
> Обязательная честность результата:
>
> - Каталог различает естественный вызов агента, направленную проверку и предположение. Сохраняет успешное восстановление после ошибки: итоговая задача может пройти при заметном ограничении среды.
> - Отсутствие Python в трассах ничего не доказывает: общий prompt уже предупреждает об отсутствии системного shell/native binaries (packages/agent/src/prompt.ts:26). Standalone Shell-probe ещё не доказывает поведение обеих браузерных линий.
> - Потолок — профиль ограничений, не одно число. Усложнение инженерной задачи, зависимости/инструменты и лимиты ресурсов дают разные границы. Размер репозитория сам по себе недостаточен.
> - Каждый выбранный путь реально усложняется до наблюдаемой границы либо явно обоснованной остановки. Успех на pilot или заданном числе простых задач этого обязательства не закрывает.
> - Повторяемый native-pass/Rifty-fail — кандидат на границу Rifty; причина требует воспроизводимой проверки. Общий fail — предел данного agent/model/budget либо неизвестная причина. Все pass — только нижняя граница проверенных возможностей.
> - Адаптивно найденные сложные случаи и их замороженное подтверждение остаются отдельным диагностическим результатом: свежие повторы не превращают отобранную по результатам выборку в беспристрастную оценку общей успешности.
> - Новый поиск границ нельзя объявлять выполненным только потому, что pilot закрыл прежний I5.
>
> Развилки пользователя: обязательной новой не нашёл. Существующий Outcome уже разрешает отрицательный результат и недостаточные данные. Вопрос «принимать общий потолок или обязательно найти native-pass/Rifty-fail» предлагает гарантировать эмпирический результат, которого может не существовать. Агент выбирает конечный протокол поиска; отчёт честно различает найденную границу, общий предел и недостигнутую границу. Это не разрешает остановиться на удобных простых сценариях: пользователь прямо отверг такой результат.
>
> Проверено чтением goal/map, детей corpus/report, process rules, prompt и baseline-probes. Новых экспериментальных прогонов не выполнял; файлов не менял.

Reception: accepted. I10 owns the catalog; I11 owns actual escalation beyond
pilot and confirmation/interpretation. The diagnostics child extends existing
records/runner, keeping exploratory selection separate from the representative
comparison. Required behavior is measured, never a guaranteed discovered flaw.

## Scope closure

| Source | Observable consequence | Authority |
|---|---|---|
| New request, differences/Python example | Catalog includes witnessed usage, directed probes, recovery and impact; Python is a candidate, not a fabricated observed failure | user + executed evidence limits |
| New request, ceiling/no ten easy passes | Execute substantive escalation in multiple families; pilot cannot close I11 | user |
| Existing own-environment score | An agent that recovers from a missing utility and completes the task still passes | prior user choice |
| Existing uncertainty/diagnostic Outcome | Report bounded evidence or unknown cause without promising an absolute or differential ceiling | prior user choice + scientific meaning |
| I7/I8, frozen corpus/script protocol | Declare exploration levels/stopping rules; fresh frozen confirmation retains diagnostic selection provenance | agent route preserving existing promises |

## External methodological evidence

- [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
  (read 2026-09-27): capability and regression suites answer different questions;
  saturated easy tasks alone do not measure the harder capability frontier.
- [Anthropic: Infrastructure noise](https://www.anthropic.com/engineering/infrastructure-noise)
  (read 2026-09-27): resource and timeout configuration affect measured agent
  outcomes. Record those settings; a score difference alone is not causal proof.

## Final written-result check

Fresh read-only `/root/boundaries_refine_final`: PASS, no findings.
Record: `agent-eval-boundaries-final-green.json`; reviewed commit
`d9057895438e9a6f78562bf1f56ec2ee028aa3ac`; driver verified all 12 hashes in
`agent-eval-boundaries-review-manifest.json`.

Reviewer independently reran the real standalone Shell probe and matched
its fields, candidate counts and selected call/results to the 42 archived
traces. No public-browser or new model-trial proof claimed.

`pnpm pr:check`: docs-only 20/20 PASS; log
`/tmp/rifty-eval-boundaries-pr-check-final.log`. Initial lint failure was
JSON array formatting only; corrected with no data change. Source lanes
were skipped. `git diff --check` and verdict validator PASS.

Refine amendment complete; implementation and real I1–I11 acceptance
remain open. I5 pilot success cannot close the boundary-search obligation.
