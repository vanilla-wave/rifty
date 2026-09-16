---
kind: epic
status: ready
title: Sandbox agent honors pi project resources — AGENTS.md context files and skills load like regular pi
created: 2026-09-16
value: A project that already carries pi/Claude-style instructions (AGENTS.md, CLAUDE.md, SKILL.md skills) gets the same agent behavior in a rifty host as under the regular pi 0.85.1 CLI — no consumer re-implementation, no silent gap.
user_story: As a developer opening my repo in the playground or an embedded @riftydev/agent, I want the agent to follow my AGENTS.md and pick up my .pi/skills exactly as pi does, but today the sandbox agent ignores both and only a consumer-passed `instructions` array reaches the prompt.
tier: works
---

## Outcome

Regular pi (`@earendil-works/pi-coding-agent` 0.85.1) assembles the project's
context files and skills into the system prompt; `@riftydev/agent` runs the
same pi loop (ADR-0424) but only its hand-authored profile plus consumer
`instructions`. After this goal the sandbox agent reads the project's context
files and skills from the host filesystem and renders them with pi's own block
shapes in pi's custom-prompt order, so the model sees on rifty what it sees
under pi on the same tree. Pi features the user ruled out stay loud: reported,
compat ❌, never silently dropped. Faithful-runtime payoff: parity is proven
against the pinned pi CLI on the same fixture tree, not assumed.

## User scenario

1. A developer opens in the playground (or an embedded `createAgentSession`
   over a workbench or sandbox host) a project whose root — the host root,
   which is the agent's cwd — holds `AGENTS.md` ("answer in pirate speak")
   and `CLAUDE.md`, plus `sub/CLAUDE.md`, `.pi/skills/deploy/SKILL.md`
   (name + description) and `.pi/skills/hidden/SKILL.md`
   (`disable-model-invocation: true`).
2. They ask "deploy this". The provider request's system prompt carries the
   rifty profile, then `<project_context>` with exactly one
   `<project_instructions path="…/AGENTS.md">` (first match per directory
   wins over `CLAUDE.md`; `sub/CLAUDE.md` is not loaded — pi reads the cwd
   and its ancestors, never descendants), then `<available_skills>` listing
   `deploy` (not `hidden`) with its location, then `Current working
   directory` — the blocks pi 0.85.1 emits for `--system-prompt <profile>`
   with the same cwd on the same tree (except the skills block's read-tool
   line, I2). The model reads `SKILL.md` with the existing `read_file` tool,
   follows it, and answers in pirate speak.
3. They edit `AGENTS.md` in the playground editor mid-session: the next turn
   still uses the old text; `/reload` in the chat re-reads, lists which files
   and skills loaded plus diagnostics; the following turn uses the new text.
4. An embedder passes `contextFiles: false` (or `skills: false`): that block is
   absent, like `--no-context-files` / `--no-skills`. User-level instructions
   or skills passed through session options land where pi puts
   `~/.pi/agent/AGENTS.md` / `~/.pi/agent/skills`.
5. The project also holds `.pi/extensions/foo.ts` and `.pi/prompts/review.md`:
   the loaded-resources report names both as unsupported and the agent's public
   compat list shows ❌; nothing pretends to run them.

## Invariants

<!-- Each false on main `51440931a`; evidence in
     `docs/backlog/distribution/reference/agent-pi-project-resources-refine-evidence.md` §False on main:
     I1/I2/I5/I6/I7 — grep `AGENTS\.md|SKILL\.md|skills|contextFiles|\.pi/` over
       packages/agent/src → 0 hits; the only prompt input is `options.instructions`
       (`packages/agent/src/prompt.ts:34`); no resource report exists. I5 is
       false by its first half (no user-level option); its no-scan clause is a
       bound, true on main by absence.
     I3 — `packages/agent/src/prompt.ts:31-34` orders cwd, date, then instructions;
       no project block exists.
     I4 — `AgentSession` (`packages/agent/src/types.ts:142-152`) has no `reload`;
       `apps/playground/src/ai/AiChatPanel.tsx` handles no chat command. -->

1. I1. Context files `AGENTS.override.md` / `AGENTS.md` / `AGENTS.MD` /
   `CLAUDE.md` / `CLAUDE.MD` (first match per directory) in the agent's cwd
   and its ancestors enter the system prompt as pi's `<project_context>`
   block — same file selection, order (root-most first, cwd last), wrapper text
   and `path` attribute as pi 0.85.1 with the same cwd on the same tree. On a
   rifty host the cwd is the host root (one root per host,
   `packages/agent/src/types.ts:47-49`; rooted file tools ADR-0424 §7), so
   the block holds that root's file; files in descendant directories are
   never loaded, as under pi.
2. I2. Skills: `SKILL.md` files under `.pi/skills` and `.agents/skills` are
   listed as pi's `<available_skills>` block — the same skill set pi 0.85.1
   discovers from the same cwd on a tree without `.pi/settings.json` skill
   overrides (settings are out of scope and reported by I7), same
   name/description/location entries, same name-collision winner and
   `disable-model-invocation` exclusion; the block's read-tool line names
   `read_file` where pi names `read` (deliberate deviation, `## Decisions`);
   the model loads a skill through the existing file-read tool, no new tool.
3. I3. The prompt always has pi's custom-prompt order: the rifty profile
   (host facts and the date line included), then consumer `instructions`
   (pi's append slot), then `<project_context>`, then the skills block, then
   `Current working directory` last; a project with neither context files nor
   skills emits no block. The profile paragraphs (ADR-0434 §3 identity) are
   unchanged; the trailing order — cwd last, instructions before the blocks —
   changes for every consumer.
4. I4. Resources are read once when the session starts and the session
   reports what loaded (files, skills, every diagnostic); `session.reload()`
   re-reads and reports again, and `/reload` in the playground chat does the
   same and shows that report. A file edited mid-session takes effect only
   after reload, as under pi.
5. I5. User-level resources arrive through session options — instruction
   text and skills the consumer supplies — and take pi's global slots (first
   `<project_instructions>` entry; listed among skills); that is the only
   user-level source — no home or user directory is scanned.
6. I6. Loading is on by default in every host (workbench and sandbox);
   `contextFiles: false` and `skills: false` switch each off like
   `--no-context-files` / `--no-skills`. In a host without file access the
   prompt states that project resources were not read.
7. I7. Pi resource kinds outside this goal found in the project —
   `.pi/extensions`, `.pi/prompts`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`,
   `.pi/settings.json`, `.pi/npm` (packages) — are named as unsupported in the loaded-resources report
   and in the agent's public compat list; none is loaded, none is silently
   ignored.

## Challenge

challenge: 2026-09-16 — 5 problems (early premise check, all resolved in-session; verdict verbatim in the evidence file §Critic)

1. Byte-comparable whole prompt unattainable (pi embeds installer-absolute docs paths) → acceptance re-cut to block-level parity in pi custom-prompt mode (user, prompt question).
2. Cheaper route unweighed: pi's own `customPrompt` branch already emits `<project_context>` → skills → cwd → adopted; tool rename rejected (user, prompt question).
3. Trust of project-carried AGENTS.md/SKILL.md had no authority → user: on by default, opt-out (I6).
4. Default-on across published surfaces → user trust answer (I6); `instructions` precedence → user prompt answer ("append (сюда `instructions`) → project_context → skills → cwd"), I3.
5. Agent-written exclusions (user-level `~/.pi`, silent skill drop without a read tool) → user: session options (I5); a host without file access states it (I6).

## Decisions

- scope: 2026-09-16 — user: "Context files + skills" — prompt templates, `/skill:`/`/name` expansion, SYSTEM/APPEND_SYSTEM.md, settings.json and extensions not selected; packages excluded by the accepted question text ("packages/`pi install` — вне scope по умолчанию") → map §Out of scope; all six kinds reported under I7 and listed compat ❌ in the agent's public compat list.
- cwd: 2026-09-16 — a rifty host has one root (`AgentHost.root`, `packages/agent/src/types.ts:47-49`; ADR-0424 §7 rooted file tools) and it is the agent's cwd; pi's ancestor walk-up therefore yields that root's file, descendants never load (I1, scenario 2); probe: evidence file §Probe (from `sub/` pi loads root + `sub/`, from root only root).
- skills header: 2026-09-16 — pi's `formatSkillsForPrompt` special-cases only `read` and otherwise says "Use bash…" (`CA/dist/core/skills.js:281-284`); our block says "Use the read_file tool to load a skill's file…" — deliberate deviation naming our real tool, everything else byte-equal (I2).
- date line: 2026-09-16 — pi has no date line; ours stays inside the profile section (custom prompt), before `instructions`; cwd moves last (I3) — carrier consequence of the prompt decision.
- no-file-access host: 2026-09-16 — `capabilities.files` absent → the prompt states project resources were not read (I6); authority: `AGENTS.md` §Fidelity / `docs/backlog/README.md` §Tier "no silent lie", not a user answer.
- trust: 2026-09-16 — user: "Вкл. по умолчанию, opt-out" — default-on in every host, opt-out options mirror pi flags (I6); any consent UI is the embedder's.
- prompt: 2026-09-16 — user: "pi custom-prompt режим" — the rifty profile is pi's custom prompt; blocks and order follow pi's `customPrompt` branch (I3); tool names and the 0.1.0 API stay.
- refresh: 2026-09-16 — user: "Как pi: старт сессии + явный reload" — once at start, `reload()`, playground `/reload`; the loaded-resources report at start and after reload comes from the trust option's accepted text "сессия отдаёт список загруженного событием" (I4).
- user-level: 2026-09-16 — user: "Через опции сессии" — no home scan (I5).
- tier: works — unreadable or invalid resource files follow pi's own diagnostic semantics (warning + skip), which is parity, not a fault mechanism; no crash/reload invariant.
- reference: `@earendil-works/pi-coding-agent` 0.85.1 (pin: ADR-0424). Context-file walk-up and the CLI block formatters are CLI-only, not browser-safe → semantic copy in `@riftydev/agent` under an ADR with a differential suite against the CLI (`docs/backlog/README.md` §Shape, external oracle); env-abstracted loaders/formatters exported by `pi-agent-core` are reused, never copied.
- ADR-0434 §3: the shared profile paragraphs and id stay identical; the assembled prompt's tail order changes (I3) for every consumer, bench included — bench contracts assert the paragraphs, not the tail order (`tools/agent-bench/tests/contract.spec.ts:74-75,106-107`); bench tasks carry no pi resources, so no block appears there. Its clause "without changing its default assembled prompt" is amended by the item-1 ADR (dated §Corrections note, `DEC-2`).
- rejected route: pi default prompt shape + tool rename `read/bash/edit/write` — violates the prompt decision (I3) and breaks the published 0.1.0 tool API; pi's docs section is unreproducible anyway.
- rejected route: consumers concatenate AGENTS.md into `instructions` — violates I1 (pi block and order) and I6 (default-on; every consumer re-implements discovery).
- rejected route: runtime dependency on `@earendil-works/pi-coding-agent` in the browser package — violates Outcome "reads … from the host filesystem" in a browser host (node fs + jiti are not browser-safe); ADR-0424 §1 pins core/ai only.
- rejected route: byte-equal whole prompt vs default pi — unattainable; violates Outcome "proven, not assumed".
