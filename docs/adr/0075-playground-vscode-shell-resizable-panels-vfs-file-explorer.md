# ADR 0075: Playground VSCode-style shell — bottom console panel, resizable/collapsible splitters, VFS file explorer, multi-model editor tabs

Status: Accepted (2026-06-04)
Date: 2026-06-04
Relates to: ADR-0073 (playground UX overhaul / terminal-luxe design system — this builds on it), ADR-0013/ADR-0014/ADR-0072 (VFS backend + split sync/async + OPFS write-through — the file explorer reads/writes the sync mirror), ADR-0002/D-001 (cross-origin isolation), D-002 (solid-js isolated to `apps/playground`).

## Context

After the ADR-0073 overhaul the playground was a polished but *fixed* three-pane layout: a left preset rail, and a `.rf-main` CSS grid that put the **console as a right-hand column** next to the editor (and a preview column in dev/real-vite). User feedback asked for four things:

1. Move the **console to the bottom** (a real bottom panel, not a side column).
2. A **VSCode-like** visual/ergonomic feel.
3. **Resizable** panel widths/heights with **collapse/expand**.
4. A **file manager** (file explorer) — the playground had none.

Plus: fix any layout (verstka) bugs and use libraries where they raise quality (the project keeps a strong zero-dependency bias).

Two facts shaped the design, both verified live against the running app and the source:

- **The heavy panes self-relayout.** `RiftyTerminal` already wires a `FitAddon` + `ResizeObserver` on its container, and Monaco runs with `automaticLayout: true`. So resizing the surrounding CSS-grid tracks reflows the editor/terminal/preview without any manual resize plumbing — a splitter only needs to change a grid track size.
- **The main-thread `syncMirror()` is a real, writable VFS.** On the playground (main-thread) realm `initBackend()` falls back to `installMemoryFs()` (OPFS sync needs a Worker realm), and the in-page shell + `npm install` write to *that same* mirror via `SyncMirrorVfs`. A file explorer over `syncMirror()` is therefore honest — it reflects user edits and terminal `npm install`, not a stub. (It is a *different* store from the worker realms that execute REPL/dev/real-vite — see Consequences.)

This change spans many files and >100 lines and alters the editor's internal contract (single `{value,onChange}` → multi-model tabs), so by the reversibility checklist (rules 2/4) it is **IRREVERSIBLE** and is recorded here, ratified inline (ADR-0063 standing authority). It introduces **no new npm dependency** and **no cross-package public-API change**.

The design was produced by a 3-proposal design panel (VSCode-faithful / terminal-luxe-native / minimal-risk) with adversarial judges; this ADR is the synthesis (VSCode-faithful base + terminal-luxe visual language + minimal-risk discipline). The judges' unanimous concern — the programmatic-`setValue` re-save guard — is resolved below (single explicit mechanism), as is the same-path dual-writer hazard.

## Decision

A VSCode-style **workbench shell** for `apps/playground`, hand-rolled (zero new deps), keeping the ADR-0073 terminal-luxe palette (deep cool-ink + single acid-lime "alive" accent, hairline borders, Bricolage eyebrows, film grain).

1. **Shell grid (console to the bottom).** `.rf-app` becomes a CSS grid: `titlebar(52)` / `[activity-bar 46 | sidebar | main]` / `status-bar(24)`. `.rf-main` is itself a vertical split — editor-area (top) over the **console bottom panel** (`grid-template-rows: 1fr <splitter> var(--rf-console-h)`). The console is the relocated `TerminalPanel`, spanning the editor-area width. In dev/real-vite the editor-area splits horizontally into `[editor | <splitter> | preview]` (preview as a right "Simple Browser" pane). This satisfies asks #1 and #2.

2. **Resizable + collapsible (ask #3).** A single hand-rolled `<Splitter>` (pointer events, min/max clamp, double-click reset, `role="separator"` + arrow-key resize) drives three CSS variables: `--rf-sidebar-w`, `--rf-console-h`, `--rf-preview-w`. Sizes + collapse flags persist to `localStorage` (`rf.layout.v1`, re-clamped on read so a stale value can't strand a panel off-screen). The sidebar collapses from the activity bar; the console collapses to a header strip (**never unmounted** — xterm stays attached and keeps receiving stdout). Drag sets `pointer-events:none` on the preview `<iframe>` so it can't swallow the pointer mid-drag.

3. **VFS file explorer (ask #4).** A lazy-expand tree of `/workspace` over the main-thread `syncMirror()`. Actions: open, new file, new folder, rename (files and dirs via a real `copyTree`+`rm`, not a stub), delete (with confirm). No VFS change events exist, so refresh = action-triggered nonce + a light 1.5 s poll of *expanded* dirs while the Explorer is visible (gated on `document.visibilityState`). On mount it ensures `/workspace` exists and seeds a couple of starter files so the explorer is immediately useful.

4. **Multi-model editor tabs.** The editor host owns one Monaco instance and **one `ITextModel` per tab** (`editor.setModel()` on switch — which emits no content event, so tab switches never spuriously write). A permanent, non-closable **"program" tab** (index 0) stays bound to `machine.source()` / `machine.setSource()` — the exact ADR-0073 path — so REPL Run, dev/real-vite `updateEntry`, and the m10 HMR textarea path are unchanged. Files opened from the explorer are additional tabs with debounced (≈300 ms) VFS write-back. The outer `<div data-testid="editor">` is unchanged.
   - **Re-save guard (the judges' flagged point), one mechanism:** external program-source changes (preset/mode transitions) write the program model under an explicit `suppressProgramEcho` flag that the single `onDidChangeModelContent` listener checks-and-clears before routing to `machine.setSource`. `setModel` (tab switch) needs no guard. This is the *only* programmatic write to a live model.
   - **Dual-writer guard:** the program tab is the **sole** editor for `/workspace/src/main.js`; opening that exact path from the explorer focuses the program tab instead of creating a second model. Program edits are mirrored one-way into that mirror file so the explorer shows it honestly.

5. **Status bar + activity bar.** The `[data-storage-badge]` element **moves verbatim** (same attributes, `data-tone`, `title`) into the new status bar (mode chip, active file, language, COI dot). The activity bar is a lime "alive spine" toggling the sidebar between **Explorer** and **Presets** (the existing `PresetGallery`, reused unchanged). Run/Reset/Dev/Real-Vite stay in the titlebar with byte-identical `data-action` attributes and the same `mode==='repl'` gate.

6. **Monaco language workers.** `monaco-env.ts` gains the standard `json` / `css` / `html` workers (Vite `?worker`) so opening non-JS files from the explorer gets real language services instead of a generic-worker error.

**E2E preserved by construction:** every load-bearing selector keeps working — `data-testid=editor` (program model is boot-active), `data-testid=terminal` (always mounted, console open by default), `data-action=run/reset/dev-mode/real-vite` (titlebar untouched), `data-storage-badge` (relocated element, same attrs, always-rendered status bar), `data-testid=preview` (same `PreviewPanel`, same mode `<Show>`), `data-testid=gallery`/`data-preset` (same `PresetGallery`; no spec needs it at boot). Pure logic (clamp math, tree builder, tab reducer, layout store) is unit-tested test-first (TDD); the layout is guarded by the existing e2e suite + live browser verification.

## Alternatives considered

- **Single Monaco model + `setValue` on tab switch** (the minimal-risk proposal). Smaller diff and reuses `EditorPanel` verbatim, but `setValue` fires `onDidChangeModelContent` on *every* programmatic swap, so it needs a suppress flag for **both** tab-switch and external sync, and it nukes per-file undo/cursor. Multi-model needs the flag for *only* external program sync and preserves undo — chosen for fidelity with a smaller guard surface.
- **A resizable-panels / split-pane / tree library** (allotment, split.js, react-resizable-panels, solid tree libs). Rejected: they are React-first or vanilla, a new dependency is IRREVERSIBLE per the checklist, and a ~90-line CSS-var-driven splitter + a lazy `readdirSync` tree are smaller than the integration glue and match the bespoke look (zero icon-font dep — extension glyphs are a small unicode map).
- **PROBLEMS panel / tabbed bottom panel** (VSCode-faithful's extra). Deferred: not one of the four asks; the bottom panel ships as a single Console for v1 (a `PROBLEMS` tab from Monaco markers is a clean follow-up).
- **Default sidebar to Presets** (preserve today's first-touch). Rejected as the default in favour of **Explorer** (the file manager is the headline ask and VSCode opens to Explorer; no e2e needs the gallery at boot). Reversible — logged in `OPEN_QUESTIONS`.
- **Emit VFS change events** instead of polling the explorer. The right long-term answer, but it touches lower layers (`@riftydev/vfs` write path) → IRREVERSIBLE and out of scope; the bounded poll is the provisional (logged).

## Consequences

- (+) All four asks are met: console at the bottom, VSCode ergonomics (activity bar / sidebar / editor tabs / bottom panel / status bar), resizable + collapsible panels with persisted sizes, and a real VFS file explorer.
- (+) No new dependency, no cross-package API change; solid-js stays inside `apps/playground`.
- (+) Per-file undo/cursor via multi-model; opening arbitrary VFS files; the explorer reflects terminal `npm install`.
- (−) The explorer operates on the **main-thread** VFS, which is a *different* store from the worker realms that execute REPL/dev/real-vite (split VFS, ADR-0014). So a file created in the explorer is not visible to REPL `require('fs')` (which runs in a worker). This is a pre-existing architectural reality, surfaced honestly (the program tab — not an explorer file — drives execution); unifying them is future work.
- (−) Refresh is a bounded poll (no VFS events); dir-rename copies subtrees; binary files open read-only via a NUL-byte sniff — all provisional, logged in `OPEN_QUESTIONS`.
- (−) Larger UI surface; correctness rests on the program-model echo guard and the never-auto-open-a-file-tab invariant, both covered by unit tests + live browser verification.
