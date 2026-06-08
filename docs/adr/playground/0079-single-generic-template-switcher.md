# ADR 0079: Single generic project/template switcher; retire the header mode toggles

Status: Accepted (2026-06-05)
Date: 2026-06-05
Relates to: ADR-0073 (terminal-luxe + PreviewPanel honest status), ADR-0075 (VSCode shell — ActivityBar/sidebar, `useMode`), ADR-0077 (real-vite preview render; emits the worker terminal markers m10 asserts), ADR-0078 (decouple-vite — the generic "Real npm project" naming this depends on). Resolves OPEN_QUESTIONS **Q-2026-06-04-316** (single-switcher half).

> TL;DR: The Templates gallery is the ONE switcher; header `.rf-seg` toggles removed, modes entered only via `loadPreset` on a `[data-preset]` tile

## Context

Two surfaces switched the playground's project/mode, duplicating each other:

1. **Header `.rf-seg`** (`App.tsx`): two buttons — `[data-action="real-vite"]` ("Real Vite", `machine.toggleRealVite()`) and `[data-action="dev-mode"]` ("Dev Mode", `machine.toggleDev()`). Each cleared `activePreset` then toggled a mode. Non-scaling (every new template needs a hand-placed button) and its toggle semantics differ from the gallery's seed-and-enter.

2. **Templates gallery** (`PresetGallery.tsx`, ActivityBar "Templates" view): renders each preset as a `[data-preset={id}]` tile calling `machine.loadPreset(preset)`, which seeds the editor **and** transitions the mode. Already scales by category and already covers the two Live-preview presets (`dev-hmr` → `dev`, `real-vite` → `real-vite`).

Q-2026-06-04-316 flagged the user's oddity: the header seg duplicates the gallery's two Live-preview presets. That question shipped a partial fix (gallery retitled "Templates", emoji → SVG) but kept the seg because the e2e suite locks its selectors, and pre-authorised this follow-up: *"a single unified switcher requires moving the `data-action`/text contracts and updating the e2e specs as a deliberate contract change (not to make code pass)."* This ADR is that follow-up; it rides on ADR-0078's generic relabel (a Vite-branded header button beside a generic gallery would re-introduce the inconsistency).

## Decision

1. **The Templates gallery is the ONE switcher.** Remove the header `.rf-seg` (both buttons). Selecting a tile is the sole way to enter `dev` / `real-vite` (or reload a REPL preset). `machine.loadPreset(preset)` already does the full seed-and-transition and tears down the other handle when crossing `dev` ↔ `real-vite`, so no reachable mode is lost. The header keeps only contextual Run/Reset (REPL) controls and the mode chip.

2. **`toggleDev()` / `toggleRealVite()` stay on `ModeMachine`** but are unwired from any UI control (removing them is a separate, reversible `useMode` cleanup). The toggles' "exit to REPL" affordance is preserved by selecting the Welcome/REPL tile (`loadPreset` with `mode: 'repl'` calls `leaveServers()`).

3. **Stable e2e hooks move onto the canonical switcher.** Tiles already expose `[data-preset={id}]` / `[data-active]` / `[data-testid="gallery"]`. To open the view, `ActivityBar.tsx`'s Templates button gains `data-action="view-templates"`. New flow: open Templates view → assert gallery visible → click target `[data-preset="…"]` → assert it became `data-active="true"`.

4. **Deliberate e2e contract change (NOT a test edited to make code pass).** Removing the seg breaks two specs whose assertions targeted a UI element that, by this decision, ceases to exist. Per CLAUDE.md and Q-2026-06-04-316's pre-authorisation, these are reframed as a contract change — the new behaviour ("one switcher; modes entered by selecting a tile") is the intended design, and the specs assert *that*:
   - **`tests/e2e/m7-preview-sw.spec.ts`** (verified passing): replace the header click + "Dev Mode" text assertion with — open Templates view (`[data-action="view-templates"]`), assert `[data-testid="gallery"]` visible (guard against `useLayout.selectView` self-collapsing the sidebar), click `[data-preset="dev-hmr"]`, assert `[data-preset="dev-hmr"][data-active="true"]`. Downstream SW round-trip assertions (`/preview/3000/` → 200, body contains "Hello from rifty" + "rifty:hmr client") are **unchanged** — they assert dev-server / SW-bridge behaviour, not the switcher.
   - **`tests/e2e/m10-hmr.spec.ts`** (skip-by-default): same view-templates + gallery-visible-guard + `[data-preset="real-vite"]` flow. **Also corrects two stale terminal-log assertions** from `[real-vite] hmr bridge ready` / `[real-vite] vite is listening` to the markers the worker actually emits — `[real-vite/worker] hmr bridge ready` / `[real-vite/worker] vite is listening`. The old strings predate the worker-realm `/worker]` prefix (added when bootstrap moved into the worker, ADR-0043/0077) and never substring-matched current output; since m10 is skip-by-default the drift was invisible. This **fixes a stale assertion to match the intended, ADR-0077-documented marker** — behavioural coverage (worker reaches "hmr bridge ready" then "vite is listening") is identical, not back-fitting a test to code (Threads #1/#2 leave those worker lines byte-for-byte; this thread is sole owner of the marker correction). Validate the opt-in path once with `RIFTY_E2E_HMR=1` before relying on it.

5. **No new switcher state.** `activePreset` stays the single source of which tile is selected; the seg's old `setActivePreset('')` deselect lines are removed with it. The mode chip (`modeLabel()`) still reflects the active mode.

## Alternatives considered

- **Keep both surfaces (Q-2026-06-04-316 v1).** Rejected: the duplication the user flagged; doesn't scale; clashes with ADR-0078's generic relabel.
- **Relabel the seg generically, keep it as quick toggles.** Rejected: preserves two switchers and the non-scaling problem; the toggle-vs-load split is exactly the duplicated control flow we want gone.
- **A header dropdown listing templates.** Rejected: a second template list duplicating the gallery's render + active-state; the gallery is already the scalable list.
- **Keep an invisible/aliased `[data-action="dev-mode"]` so old specs pass untouched.** Rejected as dishonest — a hidden control kept solely to avoid changing a test is the exact anti-pattern the hard rule prevents. The right move is the explicit contract change Q-2026-06-04-316 sanctioned.

## Consequences

- (+) One scalable switcher: adding a template is a single `PRESETS` entry — no header surgery, matching the goal of designing for more templates. Consistent with ADR-0078's generic relabel.
- (+) Removes the toggle-vs-load duplication; `loadPreset` is the single transition entry-point exercised by users and e2e alike (e2e now covers the real-user path). m7 verified passing (18/1-skip baseline).
- (+) Resolves Q-2026-06-04-316 (Promoted → this ADR).
- (−) A deliberate e2e contract change in two specs (sanctioned). The m10 marker correction is the one hard-rule-adjacent edit; recorded here as fixing a stale, never-matching assertion, not weakening a passing one.
- (−) `toggleDev`/`toggleRealVite` remain on `ModeMachine` with no caller (dead-ish API), left to keep this thread surgical; a follow-up `useMode` cleanup is reversible. Their `useMode.test.ts` coverage is unaffected (those tests never invoked the toggles).
- (−) "Exit to REPL" is now "select a REPL tile" rather than a dedicated toggle. Acceptable — modes are mutually exclusive and selecting any tile fully switches context.
