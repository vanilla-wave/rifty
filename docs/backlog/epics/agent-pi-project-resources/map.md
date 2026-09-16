# Map — agent-pi-project-resources

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `distribution/ai-agent-project-context-files` — **context-files** — owns
   the host-FS resource loader, pi custom-prompt order, `reload()`, opt-out
   and the loaded-resources report incl. unsupported kinds (I1, I3, I4 session
   half, I5 instructions half, I6, I7). Leads: the null case (no resources →
   unchanged prompt) lands first.
2. `distribution/ai-agent-project-skills` — **skills** — `.pi/skills` +
   `.agents/skills` discovery through the same loader, `<available_skills>`
   block, consumer-supplied skills (I2, I5 skills half, I6). After 1.
3. `distribution/ai-agent-playground-reload` — **playground-reload** —
   `/reload` chat command + loaded-resources/diagnostics display (I4 UI half,
   I7 visibility). After 1; independent of 2.

## Open questions

- Does `pi-agent-core` `loadSkills` discover the same set as the CLI's `loadSkillsFromDir` (root `.md` per mode, ignore files, dot-dirs, symlinks)? — owner: agent — differential cases at item 2 PICKUP decide reuse vs port.
- Walk-up bound: pi walks to the filesystem root, and to the git root for `.agents/skills`; the host root is the project root — owner: agent — item 1 probe on workbench and sandbox hosts.
- Preview-only session (no file access) at start, files later: what `reload()` reports — owner: agent — item 1 decides; the prompt states unread resources (I6).
- Proof carrier: `@earendil-works/pi-coding-agent` as a node-only devDependency of `packages/agent` for the differential suite, or an agent-bench lane with the `--no-*` flags lifted — owner: agent — item 1 PICKUP.
- ADR for the semantic copy + new public options + `reload()` + loaded-resources event, carrying the ADR-0434 §3 correction (`DEC-2`) — owner: agent — item 1 PICKUP (`pnpm adr:new distribution`).

## Out of scope

- Prompt templates (`.pi/prompts`), `/skill:` and `/name` expansion — user, 2026-09-16 (not selected); `.pi/prompts` reported under I7, compat ❌.
- `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, `.pi/settings.json` — user, 2026-09-16 (not selected); reported under I7, compat ❌.
- Extensions (`.pi/extensions`) — user, 2026-09-16; no honest browser carrier (jiti + `node:*` in the agent process); compat ❌ + I7 report.
- Packages (`pi install`, `.pi/npm`, `packages[]`) — user, 2026-09-16 (accepted question text: «packages/`pi install` — вне scope по умолчанию»); compat ❌; reported under I7.
- Scanning a home directory in the sandbox VFS — user, 2026-09-16 ("через опции сессии").
- Trust/consent UI — user, 2026-09-16: default-on; the embedder owns any consent surface.
- Renaming tools to pi's `read/bash/edit/write` — rejected route in `goal.md`.
