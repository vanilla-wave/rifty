# ADR 0075: Playground VSCode-style shell — bottom console panel, resizable/collapsible splitters, VFS file explorer, multi-model editor tabs

Status: Accepted (2026-06-04)
Date: 2026-06-04
Corrected: 2026-06-29
Relates to: ADR-0073 (terminal-luxe design system — built on it), ADR-0013/ADR-0014/ADR-0072 (VFS backend, split sync/async, OPFS write-through — explorer reads/writes the sync mirror), ADR-0002/D-001 (cross-origin isolation), D-002 (solid-js isolated to `apps/playground`).

> TL;DR: `apps/playground` gets a zero-dep VSCode-style shell: bottom console, CSS-var `<Splitter>` panels, `syncMirror()` VFS explorer, multi-model Monaco tabs

## Context

Post-ADR-0073 the playground was polished but a *fixed* three-pane layout: a left preset rail and a `.rf-main` grid with the **console as a right-hand column** next to the editor (plus a preview column in dev/real-vite). User feedback asked for four things:

1. Move the **console to the bottom** (a real bottom panel, not a side column).
2. A **VSCode-like** feel.
3. **Resizable** widths/heights with **collapse/expand**.
4. A **file manager** (none existed).

Plus: fix layout bugs; use libraries only where they raise quality (strong zero-dep bias).

Two facts (verified live + in source) shaped the design:

- **Heavy panes self-relayout.** `RiftyTerminal` already wires `FitAddon` + `ResizeObserver`; Monaco runs `automaticLayout: true`. Resizing the grid tracks reflows editor/terminal/preview with no manual resize plumbing — a splitter only changes a grid track size.
- **Main-thread `syncMirror()` is a real, writable VFS.** On the main-thread realm `initBackend()` falls back to `installMemoryFs()` (OPFS sync needs a Worker realm); the in-page shell + `npm install` write that same mirror via `SyncMirrorVfs`. An explorer over `syncMirror()` is honest, not a stub. It is a *different* store from the worker realms running REPL/dev/real-vite (see Consequences).

Spans many files / >100 lines and alters the editor's internal contract (single `{value,onChange}` → multi-model tabs), so by the reversibility checklist (rules 2/4) it is **IRREVERSIBLE**, ratified inline (ADR-0063). **No** new npm dependency; **no** cross-package public-API change.

Design came from a 3-proposal panel (VSCode-faithful / terminal-luxe-native / minimal-risk) with adversarial judges; this ADR synthesizes VSCode-faithful base + terminal-luxe visuals + minimal-risk discipline. The same-path dual-writer hazard is resolved below by the one-model-per-absolute-path invariant.

## Correction (2026-06-29)

The original Decision-4 permanent program tab was wrong after the owner-backed file-manager/Git work: it made `src/main.js` a special editor path that could not close or participate in Files/GIT like every other file. Initial editor tabs are now ordinary file tabs declared by the selected `Preset.openFiles` / project data, ordered as displayed, first active. File tabs are keyed by absolute VFS path. Opening the same path from initial tabs, Explorer, GIT, LS, or direct navigation reuses the same Monaco model. There is no permanent program tab, `PROGRAM_TAB_ID`, program model, `programMirrorPath`, or `onProgramChange`; the entry file is saved through the same owner-backed file path as every other editable file. Rename/delete closes the old path model so stale old-path writes are forbidden instead of preserved as a read-only special tab.

## Decision

A hand-rolled (zero new deps) VSCode-style **workbench shell** for `apps/playground`, keeping the ADR-0073 terminal-luxe palette (deep cool-ink + single acid-lime accent, hairline borders, Bricolage eyebrows, film grain).

1. **Shell grid (console to bottom).** `.rf-app` becomes a grid: `titlebar(52)` / `[activity-bar 46 | sidebar | main]` / `status-bar(24)`. `.rf-main` is a vertical split — editor-area (top) over the relocated `TerminalPanel` console (`grid-template-rows: 1fr <splitter> var(--rf-console-h)`), spanning the editor-area width. In dev/real-vite the editor-area splits horizontally `[editor | <splitter> | preview]` (preview as a right "Simple Browser" pane). Satisfies #1, #2.

2. **Resizable + collapsible (#3).** One hand-rolled `<Splitter>` (pointer events, min/max clamp, double-click reset, `role="separator"` + arrow-key resize) drives `--rf-sidebar-w`, `--rf-console-h`, `--rf-preview-w`. Sizes + collapse flags persist to `localStorage` (`rf.layout.v1`, re-clamped on read so stale values can't strand a panel off-screen). Sidebar collapses from the activity bar; console collapses to a header strip (**never unmounted** — xterm stays attached, keeps receiving stdout). Drag sets `pointer-events:none` on the preview `<iframe>` so it can't swallow the pointer.

3. **VFS file explorer (#4).** Lazy-expand tree of `/workspace` over main-thread `syncMirror()`. Actions: open, new file, new folder, rename (files + dirs via real `copyTree`+`rm`, not a stub), delete (with confirm). No VFS change events exist, so refresh = action-triggered nonce + a light 1.5 s poll of *expanded* dirs while Explorer is visible (gated on `document.visibilityState`). On mount ensures `/workspace` exists and seeds starter files.

4. **Multi-model editor tabs (corrected 2026-06-29).** Editor host owns one Monaco instance and **one `ITextModel` per open absolute-path file tab** (`editor.setModel()` on switch — emits no content event, so tab switches never spuriously write). The selected Starter/Project declares initial ordinary file tabs via `openFiles`; the ordered first file is active. File tabs are keyed by absolute VFS path and are closable. Opening the same path from initial tabs, Explorer, GIT, LS, or direct navigation focuses/reuses the same model. The entry file is not special: editor saves flow through the same owner-backed file write path as every other editable file, and rename/delete closes the old path model so stale writes cannot recreate it. Outer `<div data-testid="editor">` unchanged.

5. **Status bar + activity bar.** `[data-storage-badge]` **moves verbatim** (same attributes, `data-tone`, `title`) into the new status bar (mode chip, active file, language, COI dot). The activity bar is a lime "alive spine" toggling the sidebar between **Explorer** and **Presets** (existing `PresetGallery`, reused unchanged). Run/Reset/Dev/Real-Vite stay in the titlebar with byte-identical `data-action` attributes and the same `mode==='repl'` gate.

6. **Monaco language workers.** `monaco-env.ts` gains standard `json` / `css` / `html` workers (Vite `?worker`) so opening non-JS files gets real language services, not a generic-worker error.

**E2E preserved by construction:** every load-bearing selector keeps working — `data-testid=editor` (the first initial file tab is active), `data-testid=terminal` (always mounted, console open by default), `data-action=run/reset/dev-mode/real-vite` (titlebar untouched), `data-storage-badge` (relocated, same attrs, always-rendered status bar), `data-testid=preview` (same `PreviewPanel`, same mode `<Show>`), `data-testid=gallery`/`data-preset` (same `PresetGallery`; no spec needs it at boot). Pure logic (clamp math, tree builder, tab reducer, layout store) is unit-tested test-first (TDD); layout is guarded by the existing e2e suite + live browser verification.

## Alternatives considered

- **Single Monaco model + `setValue` on tab switch** (minimal-risk proposal). Smaller diff, reuses `EditorPanel` verbatim — but `setValue` fires `onDidChangeModelContent` on *every* programmatic swap, needing a suppress flag for **both** tab-switch and external sync, and it nukes per-file undo/cursor. Multi-model needs the flag for *only* external program sync and preserves undo — chosen for fidelity with a smaller guard surface.
- **A resizable-panels / split-pane / tree library** (allotment, split.js, react-resizable-panels, solid tree libs). Rejected: React-first or vanilla; a new dep is IRREVERSIBLE per the checklist; a ~90-line CSS-var splitter + a lazy `readdirSync` tree are smaller than the integration glue and match the bespoke look (zero icon-font dep — glyphs are a small unicode map).
- **PROBLEMS panel / tabbed bottom panel** (VSCode-faithful extra). Deferred: not one of the four asks; v1 ships a single Console (a `PROBLEMS` tab from Monaco markers is a clean follow-up).
- **Default sidebar to Presets** (preserve today's first-touch). Rejected in favour of **Explorer** (the file manager is the headline ask, VSCode opens to Explorer, no e2e needs the gallery at boot). Reversible — logged in `OPEN_QUESTIONS`.
- **Emit VFS change events** instead of polling. Right long-term answer but touches lower layers (`@riftydev/vfs` write path) → IRREVERSIBLE and out of scope; the bounded poll is provisional (logged).

## Consequences

- (+) All four asks met: console at the bottom, VSCode ergonomics (activity bar / sidebar / editor tabs / bottom panel / status bar), resizable + collapsible panels with persisted sizes, a real VFS file explorer.
- (+) No new dependency, no cross-package API change; solid-js stays inside `apps/playground`.
- (+) Per-file undo/cursor via multi-model; opening arbitrary VFS files; explorer reflects terminal `npm install`.
- (−) Explorer operates on the **main-thread** VFS, a *different* store from the worker realms running REPL/dev/real-vite (split VFS, ADR-0014). A file created in the explorer is not visible to REPL `require('fs')` (worker-side). Pre-existing architectural reality, surfaced honestly; unifying them is future work. Later owner-backed bridges make ordinary editor file saves converge on the owner store (ADR-0148/0185).
- (−) Refresh is a bounded poll (no VFS events); dir-rename copies subtrees; binary files open read-only via a NUL-byte sniff — all provisional, logged in `OPEN_QUESTIONS`.
- (−) Larger UI surface; correctness rests on the one-model-per-absolute-path invariant, covered by unit tests + live browser verification.
