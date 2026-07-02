/**
 * Solid layout controller for the VSCode shell (ADR-0075): panel sizes,
 * collapse flags, and the active sidebar view, hydrated from / persisted to
 * `localStorage` via the pure {@link ../glue/layout-store.ts | layout-store}.
 *
 * Persistence is explicit (on resize-commit and on toggles), not on every drag
 * tick — `onInput` only moves the signal; `onCommit`/toggles call `persist()`.
 */
import { createSignal } from 'solid-js';
import {
  LAYOUT_BOUNDS,
  LAYOUT_DEFAULTS,
  type LayoutState,
  type SidebarView,
  type StorageLike,
  loadLayout,
  saveLayout,
} from '../glue/layout-store.ts';

function safeLocalStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export interface LayoutController {
  sidebarW(): number;
  consoleH(): number;
  previewW(): number;
  aiChatW(): number;
  sidebarCollapsed(): boolean;
  consoleCollapsed(): boolean;
  aiChatOpen(): boolean;
  view(): SidebarView;
  setSidebarW(px: number): void;
  setConsoleH(px: number): void;
  setPreviewW(px: number): void;
  setAiChatW(px: number): void;
  setView(v: SidebarView): void;
  toggleSidebar(): void;
  /** Switch to `v`; if already showing `v`, collapse the sidebar (VSCode behaviour). */
  selectView(v: SidebarView): void;
  toggleConsole(): void;
  toggleAiChat(): void;
  resetSidebarW(): void;
  resetConsoleH(): void;
  resetPreviewW(): void;
  resetAiChatW(): void;
  /** Snapshot the current state into `localStorage`. */
  persist(): void;
  readonly bounds: typeof LAYOUT_BOUNDS;
}

export function useLayout(): LayoutController {
  const storage = safeLocalStorage();
  const initial = loadLayout(storage);

  const [sidebarW, setSidebarW] = createSignal(initial.sidebarW);
  const [consoleH, setConsoleH] = createSignal(initial.consoleH);
  const [previewW, setPreviewW] = createSignal(initial.previewW);
  const [aiChatW, setAiChatW] = createSignal(initial.aiChatW);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(initial.sidebarCollapsed);
  const [consoleCollapsed, setConsoleCollapsed] = createSignal(initial.consoleCollapsed);
  const [aiChatOpen, setAiChatOpen] = createSignal(initial.aiChatOpen);
  const [view, setView] = createSignal<SidebarView>(initial.view);

  const snapshot = (): LayoutState => ({
    sidebarW: sidebarW(),
    consoleH: consoleH(),
    previewW: previewW(),
    aiChatW: aiChatW(),
    sidebarCollapsed: sidebarCollapsed(),
    consoleCollapsed: consoleCollapsed(),
    aiChatOpen: aiChatOpen(),
    view: view(),
  });
  const persist = (): void => saveLayout(storage, snapshot());

  return {
    sidebarW,
    consoleH,
    previewW,
    aiChatW,
    sidebarCollapsed,
    consoleCollapsed,
    aiChatOpen,
    view,
    setSidebarW,
    setConsoleH,
    setPreviewW,
    setAiChatW,
    setView(v) {
      setView(v);
      persist();
    },
    toggleSidebar() {
      setSidebarCollapsed((c) => !c);
      persist();
    },
    selectView(v) {
      if (view() === v && !sidebarCollapsed()) {
        setSidebarCollapsed(true);
      } else {
        setView(v);
        setSidebarCollapsed(false);
      }
      persist();
    },
    toggleConsole() {
      setConsoleCollapsed((c) => !c);
      persist();
    },
    toggleAiChat() {
      setAiChatOpen((open) => !open);
      persist();
    },
    resetSidebarW() {
      setSidebarW(LAYOUT_DEFAULTS.sidebarW);
      persist();
    },
    resetConsoleH() {
      setConsoleH(LAYOUT_DEFAULTS.consoleH);
      persist();
    },
    resetPreviewW() {
      setPreviewW(LAYOUT_DEFAULTS.previewW);
      persist();
    },
    resetAiChatW() {
      setAiChatW(LAYOUT_DEFAULTS.aiChatW);
      persist();
    },
    persist,
    bounds: LAYOUT_BOUNDS,
  };
}
