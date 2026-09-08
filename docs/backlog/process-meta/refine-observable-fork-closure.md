---
area: process-meta
status: ready
title: Establish observable-scope closure before declaring refinement settled
created: 2026-09-07
why: The embedder goal became ready with an empty question frontier while registry admission and snapshot replacement policy remained unchosen; only user pushback exposed them.
user_story: As the repo owner, I want refinement to expose reachable choices affecting my scenario before ready, but today closure of discovered questions can masquerade as completeness of discovery.
sources: [docs/backlog/process-meta/reference/embedder-fork-loss-evidence.md]
---

## Context

Observed failure and historical/current rule comparison:
docs/backlog/process-meta/reference/embedder-fork-loss-evidence.md.
The user authorized the root-cause process change on 2026-09-08 and an
independent shakedown; newly found problems must be reported without repair.
The neighboring goal's product decisions stay in its session.

Dedup: searched process-meta titles/content, traps and declined concepts for
refine, frontier, scope and fork. `draft-gate-enforcement` prevents implementing
a draft; this failure occurred with a formally ready goal. No same-boundary item.

## User scenario

A maintainer brings an integration outcome with coupled persistent state and
new inputs. Refine must check material observable choices against the original
request before declaring scope settled, preserve already accepted choices, and
keep carriers agent-owned. Independent shakedown findings are reported without
automatically extending this repair.

## Acceptance

1. One canonical scope-closure rule is used by refine, FIT and Challenge; empty known frontier alone cannot establish closure. → scenario
2. Material reachable choices need authority or an explicit user decision; dependent choices return after answers without a full design gate or repeated approval. → scenario
3. Independent shakedown rehearses varied real-seeded scenarios and reports remaining failures without repairing them. → scenario

## Out of scope

Product implementation, new semantic machine gates, fixes to shakedown findings.

## Approach

Chosen direction: strengthen existing refine/FIT/Challenge, keeping one
research/interview loop and reusing its evidence:

- Before declaring scope settled, compare raw user input with the proposed
  scenario. For each consequential assumption, name the observable difference
  and its authority: user answer, applicable baseline/ADR/reference, or open
  user choice. Existing behavior establishes a fact; it does not alone settle
  a newly requested policy. A narrower test fixture does not decide scope.
- Walk applicable, reachable lifecycle transitions and feature interactions,
  especially existing edited state meeting new input/configuration. Test the
  draft with two implementations that both satisfy its words but give different
  user results. Ask only if the difference materially affects the requested
  value and no accepted scope/ADR/baseline answers it. Cite that connection;
  hypothetical unrelated features create no question. Keep carriers agent-owned.
- After each answer or material discovery, revisit affected dependent choices.
  Before the completion report/FIT ready, record what was checked and the
  authority closing each consequential difference. Open user choices remain
  visible; ask the informed frontier together and continue independent work.
- Extend the existing fresh Challenge to check omitted choices against raw
  input, not only value and cheaper routes within the written solution. A
  grounded unresolved scope choice returns to refine; it does not authorize
  the critic's preferred feature or become merely an implementation concern.

Record compact evidence in existing Decisions/reference/map locations, without
a parallel approval ledger, mandatory new reviewer or arbitrary question quota.
Record material assumptions and disputed exclusions, not every source/state
combination. Distinguish a newly requested capability from an omitted decision.
Do not reopen unchanged choices with valid authority. A machine can check a
record's presence and links, never prove semantic completeness or user consent.

## Validation

Replay the pre-closure embedder inputs independently, withholding later answers:
detect the changed-snapshot/edited-project transition and classify registry
admission as unresolved scope, not a requirement for private auth. Distinguish
archive readability/path admission from internal envelope spelling. Once apply
mode is chosen, expose its conflict policy; before then, mark it dependent.
Include settled baseline-only and just-file controls: no manufactured interview.
Evaluate detection and attribution, not keyword presence or document length.

## Decisions

- 2026-09-08 — user authorized careful root-cause fix plus independent shakedown; report new problems before further repair; docs-only preparation per RDY-8, prior Challenge reused.

- 2026-09-07 — user requested diagnosis and proposed prevention; formalized a draft, no process or product behavior changed.

## Challenge

challenge: 2026-09-07 — 2 problems

1. **Слишком широкий критерий развилки.** «Две допустимые реализации наблюдаемо различаются» срабатывает почти всегда. Нужны дополнительно: достижимый сценарий, существенное влияние на запрошенную ценность, отсутствие ответа в принятом scope/ADR/baseline. Иначе агент отдаёт пользователю свои решения вопреки `RDY-6`, `STOP-1`.
2. **Риск обязательного полного реестра.** «Все источники × все переходы × все решения» создаёт второй контракт и имитацию полноты. Дешевле усилить существующий FIT §3: краткая запись только существенных предположений, переходов и спорных исключений; источник → наблюдаемый результат → authority/owner → решение или открытый вопрос. Подробности — existing evidence, без нового артефакта/гейта.

Response: bounded the counterexample by requested value and existing authority;
limited records to material assumptions/exclusions in existing artifacts.
No full Cartesian inventory or extra stage proposed. Independent critic:
`/root/challenge_fork_prevention`, 2026-09-07.
