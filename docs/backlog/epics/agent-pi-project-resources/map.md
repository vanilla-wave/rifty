# Map — agent-pi-project-resources

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `distribution/ai-agent-project-context-files` — context, skills, session
   snapshot/report and playground reload together; I1–I7. Empty-resource
   profile preserved; tail follows I3 too.

## Open questions

None. Pickup/ADR-0440 resolve carrier questions; ledger records the re-cut.

## Out of scope

- Prompt templates (`.pi/prompts`), `/skill:` and `/name` expansion — user, 2026-09-16 (not selected); `.pi/prompts` reported under I7, compat ❌.
- `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, `.pi/settings.json` — user, 2026-09-16 (not selected); reported under I7, compat ❌.
- Extensions (`.pi/extensions`) — user, 2026-09-16; no honest browser carrier (jiti + `node:*` in the agent process); compat ❌ + I7 report.
- Packages (`pi install`, `.pi/npm`, `packages[]`) — user, 2026-09-16 (accepted question text: «packages/`pi install` — вне scope по умолчанию»); compat ❌; reported under I7.
- Scanning a home directory in the sandbox VFS — user, 2026-09-16 ("через опции сессии").
- Trust/consent UI — user, 2026-09-16: default-on; the embedder owns any consent surface.
- Renaming tools to pi's `read/bash/edit/write` — rejected route in `goal.md`.
