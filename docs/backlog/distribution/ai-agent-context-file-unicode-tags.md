---
area: distribution
status: draft
title: Decide whether the agent strips invisible Unicode tag characters from loaded AGENTS.md/CLAUDE.md and SKILL.md before they enter the prompt
created: 2026-09-27
why: Project context files and skills now load into the system prompt by default (landed goal agent-pi-project-resources); pi 0.85.1 loads them verbatim, while Claude Code strips U+E0000–E007F since 2026-02-10 after a demonstrated repository-exfiltration injection — a strip deviates from pi byte parity, so it is a user choice, not an agent default.
sources: [docs/backlog/distribution/reference/agent-weak-models-refine-evidence.md, docs/backlog/distribution/reference/agent-pi-project-resources-pickup-evidence.md]
code: [packages/agent/src/resource-files.ts, packages/agent/src/project-skills.ts, packages/agent/src/prompt.ts]
---

## Question

Invisible Unicode tag characters (U+E0000–E007F) render as nothing in editors
but are read by the model. A cloned repository's `AGENTS.md` / `SKILL.md` can
carry hidden instructions this way (CSA research note 2026-05-06; Claude Code
patched 2026-02-10 — evidence file §Research "Security"). The landed loader
(`resource-files.ts`, `project-skills.ts`) follows pi 0.85.1: context-file
bodies enter `<project_context>` byte-for-byte; for skills only name,
description and location enter `<available_skills>` (`prompt.ts:44-50`,
metadata-only formatter) and the body reaches the model later through
`read_file` — both surfaces can carry tag characters.

Should the sandbox agent (a) keep pi byte parity and only report the presence
of such characters in the loaded-resources report, or (b) strip them before
the prompt (deviation from pi, recorded in an ADR), or (c) refuse to load a
file that contains them (loud, compat ❌ for that file)? Each is observable to
the user: the prompt content differs, or a file is skipped. Probe first: what
pi 0.85.1 itself does with such bytes (verbatim, per the differential oracle
`agent-pi-project-resources-oracle.mjs`).

Owner: user (scope) at pickup via `rifty-refine`; the probe is agent work.
Trigger: any agent security pass, or the next change to the resource loader.
Discovered during `epics/agent-weak-models` refine (2026-09-21); routed here
because the resources goal closed before the finding could ride it.

## Challenge

challenge: 2026-09-27 — factual capture with an open user fork; no premise critic (README §Challenge); the strip-vs-parity choice stays the user's.
