# ADR 0079: Single generic project/template switcher; retire the header mode toggles

Status: Accepted (2026-06-05)
Date: 2026-06-05
Relates to: ADR-0073 (terminal-luxe design + PreviewPanel honest status), ADR-0075 (VSCode shell — ActivityBar + sidebar views, `useMode`), ADR-0077 (real-vite preview render; produces the worker terminal markers the m10 spec asserts), ADR-0078 (decouple-vite — lands the generic "Real npm project" naming this depends on). Resolves OPEN_QUESTIONS **Q-2026-06-04-316** (the single-switcher half).

## Context

Two surfaces switched the playground's project/mode and duplicated each other:

1. **The header `.rf-seg`** (`App.tsx`): two buttons — `[data-action="real-vite"]` (text "Real Vite", `machine.toggleRealVite()`) and `[data-action="dev-mode"]` (text "Dev Mode", `machine.toggleDev()`). Each cleared `activePreset` then toggled a mode. Non-scaling: every new template would need another hand-placed header button, and the toggle semantics differ from the gallery's seed-and-enter.

2. **The Templates gallery** (`PresetGallery.tsx`, behind the ActivityBar "Templates" view): renders every preset as a `[data-preset={id}]` tile and calls `machine.loadPreset(preset)`, which seeds the editor **and** transitions the mode. This surface already scales by category and already covers the two "Live preview" presets (`dev-hmr` → `dev`, `real-vite` → `real-vite`).

Q-2026-06-04-316 captured the user's "странность": the header seg duplicates the gallery's two Live-preview presets. That question shipped the partial fix (gallery retitled "Templates", emoji → SVG icons) but kept the header seg because the e2e suite locks its selectors, and pre-authorised exactly this follow-up: *"If we want a single unified switcher … the `data-action`/text contracts must move with it and the e2e specs updated as a deliberate contract change (not to make code pass)."* This ADR is that follow-up, and it rides on ADR-0078's generic relabel (a Vite-branded header button beside a generic gallery would re-introduce the inconsistency).

## Decision

1. **The Templates gallery is the ONE switcher.** Remove the header `.rf-seg` block (both buttons). Selecting a tile is the sole way to enter `dev` / `real-vite` (or reload a REPL preset). `machine.loadPreset(preset)` already does the full seed-and-transition and already tears down the other handle when crossing `dev` ↔ `real-vite`, so no reachable mode is lost. The header keeps only the contextual Run / Reset (REPL) controls and the mode chip.

2. **`toggleDev()` / `toggleRealVite()` stay on `ModeMachine`** but are no longer wired to any UI control (removing them is a separate, reversible `useMode` cleanup). The "exit to REPL" affordance the toggles gave is preserved by selecting the Welcome/REPL tile (`loadPreset` with `mode: 'repl'` calls `leaveServers()`).

3. **Stable e2e hooks move onto the canonical switcher.** The gallery tiles already expose `[data-preset={id}]` / `[data-active]` / `[data-testid="gallery"]`. To open the Templates view, `ActivityBar.tsx`'s Templates button gains a stable `data-action="view-templates"`. The new e2e flow is: open Templates view → assert the gallery is visible → click the target `[data-preset="…"]` tile → assert it became `data-active="true"`.

4. **Deliberate e2e contract change (NOT a test edited to make code pass).** Removing the header seg breaks two specs whose assertions are *intended* contracts on a UI element that, by this decision, ceases to exist. Per CLAUDE.md and Q-2026-06-04-316's pre-authorisation, these are reframed as a contract change — the new behaviour ("one switcher; modes are entered by selecting a template tile") is the intended design, and the specs assert *that*:
   - **`tests/e2e/m7-preview-sw.spec.ts`** (verified passing): replace the header click + "Dev Mode" text assertion with: open the Templates view (`[data-action="view-templates"]`), assert `[data-testid="gallery"]` visible (guard against `useLayout.selectView` self-collapsing the sidebar), click `[data-preset="dev-hmr"]`, assert `[data-preset="dev-hmr"][data-active="true"]`. The downstream SW round-trip assertions (`/preview/3000/` → 200, body contains "Hello from rifty" + "rifty:hmr client") are **unchanged** — they assert behaviour produced by the dev server / SW bridge, not by the switcher.
   - **`tests/e2e/m10-hmr.spec.ts`** (skip-by-default): replace the header click with the same view-templates + gallery-visible-guard + `[data-preset="real-vite"]` flow. **Additionally, correct two stale terminal-log assertions** from `[real-vite] hmr bridge ready` / `[real-vite] vite is listening` to the markers the worker actually emits — `[real-vite/worker] hmr bridge ready` / `[real-vite/worker] vite is listening`. The old `[real-vite] …` strings predate the worker-realm `/worker]` prefix (added when the bootstrap moved into the worker, ADR-0043/0077) and never substring-matched current output; because m10 is skip-by-default the drift was invisible. This is **fixing a stale assertion to match the intended, ADR-0077-documented marker** — the behavioural coverage (worker reaches "hmr bridge ready" then "vite is listening") is identical; it is not back-fitting a test to code (Threads #1/#2 leave those worker lines byte-for-byte; this is the sole owner of the marker correction). Validate the opt-in path once with `RIFTY_E2E_HMR=1` before relying on it.

5. **No new switcher state.** `activePreset` stays the single source of which tile is selected; the seg's old `setActivePreset('')` deselect lines are removed with it. The mode chip (`modeLabel()`) still reflects the active mode.

## Alternatives considered

- **Keep both surfaces (Q-2026-06-04-316 v1).** Rejected: the duplication the user flagged; doesn't scale; clashes with ADR-0078's generic relabel.
- **Relabel the header seg generically and keep it as quick toggles.** Rejected: preserves two switchers and the non-scaling problem; the toggle-vs-load split is exactly the duplicated control flow we want to delete.
- **A header dropdown listing templates.** Rejected: builds a second template list duplicating the gallery's render + active-state; the gallery is already the scalable list.
- **Keep an invisible/aliased `[data-action="dev-mode"]` element so the old specs pass untouched.** Rejected as dishonest — a hidden control kept solely to avoid changing a test is the exact anti-pattern the hard rule prevents. The right move is the explicit, justified contract change Q-2026-06-04-316 sanctioned.

## Consequences

- (+) One scalable switcher: adding a template is a single `PRESETS` entry — no header surgery, matching "заложим так, чтобы там могло быть больше шаблонов." Consistent with ADR-0078's generic relabel.
- (+) Removes the toggle-vs-load duplication; `loadPreset` is the single transition entry-point exercised by users and e2e alike (the e2e now covers the path real users take). m7 verified passing (18/1-skip baseline).
- (+) Resolves Q-2026-06-04-316 (Promoted → this ADR).
- (−) A deliberate e2e contract change in two specs (sanctioned). The m10 marker correction is the one hard-rule-adjacent edit; recorded here as fixing a stale, never-matching assertion, not weakening a passing one.
- (−) `toggleDev`/`toggleRealVite` remain on `ModeMachine` with no caller (dead-ish API), left to keep this thread surgical; a follow-up `useMode` cleanup is reversible. Their `useMode.test.ts` coverage is unaffected (those tests never invoked the toggles).
- (−) "Exit to REPL" is now "select a REPL tile" rather than a dedicated toggle. Acceptable — modes are mutually exclusive and selecting any tile fully switches context.
