---
area: distribution
status: draft
title: Discover the project's SKILL.md skills and list them to the model as pi's available_skills block
created: 2026-09-16
why: Regular pi lists `.pi/skills` and `.agents/skills` skills in the system prompt and the model loads them with the read tool; the sandbox agent has no skill discovery at all.
user_story: As a developer with `.pi/skills/deploy/SKILL.md`, I want the sandbox agent to see and load the skill like pi does, but today the prompt never mentions it.
epic: agent-pi-project-resources
blocked_by: [distribution/ai-agent-project-context-files]
sources: [docs/backlog/distribution/reference/agent-pi-project-resources-refine-evidence.md]
code: [packages/agent/src/prompt.ts, packages/agent/src/tools.ts]
---

## Context

finding — goal slice 2 (I2, I5 skills half, I6).

- Oracle (evidence file §Probe): pi 0.85.1 discovers `.pi/skills` in cwd and
  `.agents/skills` in cwd and ancestors up to the git root; `SKILL.md`
  frontmatter `name` (falls back to the directory name), required
  `description`, `disable-model-invocation`; name collisions first-wins with a
  diagnostic; the block is `formatSkillsForPrompt(skills, fileReadTool)` —
  header lines, then `<available_skills>` with `name`/`description`/`location`;
  the model loads a skill by reading `location` with the named read tool.
- `pi-agent-core` 0.85.1 exports env-abstracted `loadSkills(env, dirs, ctx)`
  and `formatSkillsForSystemPrompt` (header wording differs from the CLI's;
  no read-tool name parameter) over a `FileSystem` interface with no `node:*`
  imports — a rifty host adapter needs `listDir`, `readTextFile`, `fileInfo`,
  `joinPath`, `exists`.
- Carrier notes for PICKUP: reuse the core loader if the differential cases
  match the CLI set (goal map fog), else port; the block text follows the
  CLI formatter except the read-tool line, which names `read_file` (pi's
  formatter special-cases only `read`, else says "Use bash…" —
  `CA/dist/core/skills.js:281-284`; goal `## Decisions` "skills header");
  `.pi/settings.json` `skills[]` overrides are out of scope (I2 bound);
  consumer-supplied skills take pi's user-level slot (I5); `skills: false`
  opts out (I6).

## Challenge

Premise checked at goal level (`epics/agent-pi-project-resources/goal.md` §Challenge, 2026-09-16); reuse for unchanged promises at PICKUP.

## Decisions

- Inherits goal decisions. Blocked by slice 1: shares its loader, reload and report.
