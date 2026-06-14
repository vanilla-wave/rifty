# ADR 0140: JetBrains Mono throughout playground

Status: Accepted
Date: 2026-06-14

> TL;DR: Playground chrome, code surfaces, terminal, and seeded sandbox previews all use JetBrains Mono; Inter is retired from the active UI.

## Context

ADR-0124 adopted the Soft Panels handoff with Inter for UI and Roboto Mono for code. Later feedback changed the mono face to JetBrains Mono, but only code-like surfaces and some preview snippets moved. Main still rendered playground chrome labels such as `.rf-tpl__rowlabel` with Inter, visible in DevTools.

## Decision

Use JetBrains Mono as the single playground font family:

- `--rf-font-sans` and `--rf-font-mono` both lead with `"JetBrains Mono"`.
- Critical pre-bundle `index.html` styles preload/use JetBrains Mono.
- Seeded sandbox preview CSS uses the shared JetBrains Mono stack for body, headings, and code-like text.

This supersedes ADR-0124 only for the Inter UI-font choice. Soft Panels layout, colors, and component structure remain unchanged.

## Consequences

- One visible typeface across playground chrome, editor, terminal, and seeded previews.
- Inter font files may be deleted once no historical artifact needs them.
- Denser mono UI is accepted as the intended look.
