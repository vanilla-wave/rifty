---
area: distribution
status: ready
title: Honor pi project context and skills with explicit session and playground reload
created: 2026-09-16
why: The sandbox agent ignores project instructions regular pi loads; this slice owns the resource loader, pi custom-prompt order, reload and the loaded-resources report.
user_story: As a developer with an AGENTS.md in my repo, I want the playground/embedded agent to follow it like pi does, but today only a consumer-passed `instructions` array reaches the prompt and the playground passes none.
epic: agent-pi-project-resources
blocked_by: []
sources: [docs/backlog/distribution/reference/agent-pi-project-resources-refine-evidence.md]
code: [packages/agent/src/prompt.ts, packages/agent/src/session.ts, packages/agent/src/types.ts]
---

## Context

One delivered behavior: pi project resources in every agent host and chat.
Replaces the three draft carriers; accepted goal unchanged. Evidence:
`docs/backlog/distribution/reference/agent-pi-project-resources-pickup-evidence.md`.

## Challenge

challenge: 2026-09-18 — clear; unchanged goal premise, reusing accepted FIT.
Independent DEC-2 probe selects CLI port + core formatter (ADR-0440).

## Reference contract

Pi coding-agent 0.85.1 full DefaultResourceLoader and custom-prompt branch;
core formatter reused. Differential carrier:
`tools/agent-bench/src/project-resources.test.ts`, real Node tree + MemoryVfs.

## Acceptance

1. First context candidate at host root, BOM stripped, no descendant scan; user context first; pi block bytes and append/context/skills/cwd order → I1, I3, I5
2. CLI skill set, names/descriptions/locations, first-wins collisions, hidden exclusion, metadata diagnostics; supplied global skills after project; read_file loads real skill content → I2, I5
3. Initial load and resources event; cached instructions until reload, reload returns and emits report; playground editor edit followed by /reload changes following request without model dispatch for the command → I4
4. Default-on; independent contextFiles/skills opt-outs apply to both supplied/project resources; no-file host states resources unread → I6
5. All six unsupported kinds named in report and README compat ❌; UI shows files, skills and diagnostics → I7

## Parity cases

1. All five context candidates, first-match selection, BOM, descendant exclusion and global order against pi context loader → I1, I5
2. Full CLI pi/agents discovery: root/nested markdown differences, SKILL root cutoff, dot/node_modules/ignore exclusion, BOM, collisions, hidden flag, missing description; formatter bytes except agreed read_file line → I2
3. Profile unchanged; append before blocks, cwd last, no empty resource blocks → I3

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| poisoned-cache × edit then send/reload | snapshot retained until explicit reload | project-resources.test.ts + ai-mode.spec.ts | → I4 |
| corrupt-input × skill metadata | pi warnings/skip; report carries diagnostics | same-tree CLI invalid skill | → I2, I4 |
| observable-order × timeout/stop/dispose during resource read | no post-cancellation model dispatch; reads settle before close | startup/reload budget and cancellation cases in project-resources.test.ts | → ADR-0424 |
| false-fallback × missing file capability | report/prompt name unread resources | no-file host test | → I6 |

## Out of scope

Goal exclusions unchanged: templates/expansion, SYSTEM/APPEND_SYSTEM,
settings, extensions/packages reported unsupported; no home scanning or trust UI.

## Decisions

ready-verdict: 2026-09-18 — Contract+RED @ 81d4664705266f360ba2a45b3aefcbf288bf5690

re-cut: 2026-09-18 — combine ai-agent-project-context-files, ai-agent-project-skills and ai-agent-playground-reload into one resource delivery and checkpoint; all I1–I7 retained — trace: none
- 2026-09-18 — ADR-0440: public API, semantic copy, dependency pins, ADR-0434 correction.
- 2026-09-18 — host root is cwd; adapters already expose it. Preview → commands requires explicit reload, preserving I4 cache semantics.

re-cut: 2026-09-18 — add resource-await timeout admission regression under existing ADR-0424 budget baseline; observed RED, no scope change — trace: none
