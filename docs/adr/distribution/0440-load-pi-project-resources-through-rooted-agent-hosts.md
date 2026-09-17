# ADR 0440: Load pi project resources through rooted agent hosts

Status: Accepted
Date: 2026-09-18

## Context

Agent project-resources goal I1–I7 pins pi 0.85.1. Public hosts expose one
root/cwd and read/list; no ambient home or symlink API. ADR-0424 owns hosts.

## Decision

1. Load context and skills at session creation; `send` awaits that initial
   read. `reload(): Promise<AgentResourceReport>` explicitly replaces the
   snapshot; a `resources` event reports initial/reloaded files, skills,
   diagnostics and unsupported kinds. Reload requires an idle live session;
   send awaits an admitted reload. Reuse session admission; no extra queue.
2. Options: `contextFiles?: boolean`, `skills?: boolean` default true;
   `userContextFiles?: readonly {path, content}[]` and `userSkills?: readonly
   {name, description, filePath, disableModelInvocation?}[]` supply global
   entries. Skill locations must be readable through the host's rooted file
   tool; consumer materializes them there. No home scan. Project skill
   collisions precede user skills, as CLI. Global context precedes project.
3. Port CLI context selection, package-manager pi/agents discovery and skill
   metadata validation over AgentFiles. Pin direct `ignore` 7.0.5 and `yaml`
   2.9.0, the reference dependencies. Reuse core's exported
   `formatSkillsForSystemPrompt`; replace its read instruction with the real
   `read_file` name and prepend CLI whitespace. Same-tree differential tests
   use full CLI DefaultResourceLoader 0.85.1 in the existing agent-bench tool.
   Built-in hosts do not support symlinks; no invented symlink metadata.
4. Preserve profile id/paragraphs. Assemble profile (date included), consumer
   append instructions, project context, skills, cwd last. **Supersedes only
   ADR-0434 decision 3's “without changing its default assembled prompt”
   clause.** Empty-resource prompts adopt this tail too.
5. Missing files are absent; read/parse errors produce diagnostics and skip.
   No-file hosts report unread resources in prompt/report; explicit reload
   after returning to file mode loads them. `.pi/extensions`, `.pi/prompts`,
   `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, `.pi/settings.json`, `.pi/npm`
   are reported unsupported, compat ❌. `/reload` renders the same report
   without a model request; it does not erase conversation history.

## Alternatives

- Core loader unchanged: loses BOM skills, changes `.agents` discovery and
  collision winners; fails I2 (executed probe in pickup evidence).
- Core loader behind a synthetic filesystem: still needs CLI discovery,
  metadata/ordering corrections and unused ExecutionEnv methods; more
  machinery than a direct port. Rejected under REV-7.
- Runtime CLI dependency: node fs/path/jiti cannot enter browser graph.
- Consumer concatenation: loses default discovery and pi ordering (I1/I6).

## Evidence

`docs/backlog/distribution/reference/agent-pi-project-resources-pickup-evidence.md`.
Independent DEC-2 decision reviewer: resource_decision; raw full CLI/core probe.
