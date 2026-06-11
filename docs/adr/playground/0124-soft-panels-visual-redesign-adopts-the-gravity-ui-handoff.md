# ADR 0124: Soft Panels visual redesign adopts the Gravity UI handoff

Status: Accepted (2026-06-11)
Date: 2026-06-11

> TL;DR: playground UI rebuilt to the designer-supplied "Soft Panels" handoff (Gravity UI tokens, rounded card panels, rifty lime #C7F05A, Inter + Roboto Mono); template switcher moves to the top bar, activity bar + sidebar gallery removed, global ⌘K command palette added.

## Context

User supplied a high-fidelity HTML design handoff ("Rifty IDE — Soft Panels", Gravity UI token set) and directed a redesign. Old UI: "terminal-luxe" hairline-divided shell (IBM Plex Mono + Bricolage), activity-bar + sidebar preset gallery (ADR-0079 contract), VSCode-style status bar.

## Decision

Adopt the handoff as the design source of truth; recreate it in the existing Solid components (no new deps).

- **Tokens**: page `#131419`; card panels `#1D1F26` (border `rgba(255,255,255,.08)`, r10, 12px gaps, 14px page padding); inset `#14161B`; pop `#23262E`; lime accent `#C7F05A` (+ tints per handoff); white-alpha text ramp .9/.7/.5/.4/.32/.22; Inter (UI) + Roboto Mono (code/terminal/chips), self-hosted variable woff2, latin+cyr subsets (D-001: no CDN).
- **Structure**: top bar card = logo + template-switcher chip + LIVE/STARTING/STOPPED pill + ⌘K command bar + GitHub + lime Share (copies URL, success toast). Files panel (232) · editor card (chip tabs) · preview card (browser chrome: traffic dots, lock+host address, phase pill, reload/open) · terminal card (212; eyebrow + chip tabs + Stop). Status bar → borderless caption row (keeps `[data-storage-badge]`, COI).
- **Removed**: ActivityBar, sidebar PresetGallery, film grain, glow effects. Template switching now only via top-bar dropdown; e2e contract preserved by carrying `data-action="view-templates"` (chip), `data-testid="gallery"` (dropdown), `data-preset=<id>` (rows) — extends ADR-0079's single-switcher decision, does not contradict it.
- **Added**: global ⌘K `CommandPalette` (templates / workspace files / shell actions) — mockup's command bar made real.
- **Editor/terminal surfaces**: Monaco theme on `#1D1F26` with handoff syntax tokens (keyword lime, string `#6FD89A`, fn `#7FB5FF`, prop `#C9A6FF`, num `#FFAD7A`); xterm `#1D1F26` both schemes (light-OS users previously got a light terminal inside the dark shell — bug, fixed).
- **Splitters kept** (deviation from static mockup): they live in the 12px gaps, grip visible on hover only. Stop button kept in terminal head (handoff removed it but notes a control must exist).

## Options considered

- **(a) Faithful static mockup** (no splitters, no status bar, bell+avatar). Loses working resize/status affordances; fake bell/avatar lie. Rejected.
- **(b) Handoff visuals + existing functional affordances (chosen).** Pixel-level tokens from the handoff; real controls survive restyled; decorative-only elements (bell, avatar) dropped, GitHub link takes their slot.
- **(c) Keep old theme, recolor only.** Not a redesign; rejected as not the task.

## Consequences

- One design language across all chrome; design tokens centralized in `theme.css` (`--rf-*` renamed to semantic Soft-Panels set).
- Layout storage key bumped `rf.layout.v1` → `v2`: v1 sizes fit the old shell, and a persisted `sidebarCollapsed=true` had no recovery UI post-activity-bar (adversarial review finding). Files-panel toggle lives in the ⌘K palette.
- Sidebar `view`/`selectView` in layout-store are vestigial — kept for store compat.
- Old fonts (IBM Plex Mono, Bricolage) deleted; Inter + Roboto Mono OFL files in `public/fonts`.
- e2e markup contract preserved (m0 wordmark `<strong>`, `.rf-tab` roles, terminal testids, storage badge, gallery selectors; `+` stays flush to terminal tabs per m1 pin).
- Cross-package additive API: `@riftydev/terminal` gains optional `RiftyTerminalOptions.lineHeight` (default 1) so the playground can hit the handoff's terminal 12px/19px type — recorded here, no separate ADR.
- Documented deviation: handoff's `min-width: 1240px` shell not adopted; the pre-existing ≤880px responsive collapse (files panel hidden, preview stacked, cmdbar hidden) is kept as a functional improvement.

## Reversibility classification

**IRREVERSIBLE** — genuine design choice with live alternatives (observable UI behavior: switcher relocation, palette, activity-bar removal). Extends ADR-0079. Recorded inline per record-and-continue.

## Acceptance

- [x] typecheck / lint / unit / build green
- [x] e2e (chromium) green with unchanged specs
- [x] Visual check against the handoff reference (screenshots)
