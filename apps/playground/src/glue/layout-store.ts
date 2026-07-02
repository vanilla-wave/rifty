/**
 * Persisted layout state for the VSCode shell (ADR-0075): panel sizes, collapse
 * flags, and the active sidebar view. Solid-free and storage-injected so the
 * clamp-on-read defence (a stale value must never strand a panel off-screen)
 * and the malformed-JSON fallback are unit-testable without `localStorage`.
 */
import { clampSize } from './splitter-size.ts';

export type SidebarView = 'explorer' | 'presets' | 'scm';

export interface LayoutState {
  /** Sidebar width, px. */
  sidebarW: number;
  /** Console (bottom panel) height, px. */
  consoleH: number;
  /** Preview pane width, px (dev/real-vite only). */
  previewW: number;
  /** AI chat panel width, px (ADR-0190 "+chat" view). */
  aiChatW: number;
  sidebarCollapsed: boolean;
  consoleCollapsed: boolean;
  /** AI mode panel visibility (persists like the other panel state). */
  aiChatOpen: boolean;
  view: SidebarView;
}

/** The minimal `localStorage` surface used here. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// v2: Soft Panels redesign (ADR-0124). v1 state is intentionally orphaned —
// its sizes fit the old shell, and a persisted sidebarCollapsed=true had no
// recovery UI once the activity bar was removed.
export const LAYOUT_KEY = 'rf.layout.v2';

/* Soft Panels mockup sizes started at files 232 · preview 464; preview widened
   for main's default browser, terminal raised to 280 for useful log depth. */
export const LAYOUT_DEFAULTS: LayoutState = {
  sidebarW: 232,
  consoleH: 280,
  previewW: 560,
  aiChatW: 380,
  sidebarCollapsed: false,
  consoleCollapsed: false,
  aiChatOpen: false,
  // Explorer is the boot default — the file manager is the headline feature.
  // TODO(backlog: playground/sidebar-boot-default-view)
  view: 'explorer',
};

/** Static clamp bounds (the splitter additionally re-clamps against the live container). */
export const LAYOUT_BOUNDS = {
  sidebarW: [180, 560] as const,
  consoleH: [120, 900] as const,
  previewW: [320, 1280] as const,
  aiChatW: [300, 720] as const,
};

/** Clamp the numeric fields into {@link LAYOUT_BOUNDS}; leave flags/view as-is. */
export function clampLayout(state: LayoutState): LayoutState {
  return {
    ...state,
    sidebarW: clampSize(state.sidebarW, LAYOUT_BOUNDS.sidebarW[0], LAYOUT_BOUNDS.sidebarW[1]),
    consoleH: clampSize(state.consoleH, LAYOUT_BOUNDS.consoleH[0], LAYOUT_BOUNDS.consoleH[1]),
    previewW: clampSize(state.previewW, LAYOUT_BOUNDS.previewW[0], LAYOUT_BOUNDS.previewW[1]),
    aiChatW: clampSize(state.aiChatW, LAYOUT_BOUNDS.aiChatW[0], LAYOUT_BOUNDS.aiChatW[1]),
  };
}

function isView(v: unknown): v is SidebarView {
  return v === 'explorer' || v === 'presets' || v === 'scm';
}

/**
 * Load + clamp persisted layout, merging over {@link LAYOUT_DEFAULTS}. Any
 * read/parse failure (private mode, missing key, malformed JSON, wrong types)
 * silently yields the defaults — layout state is never load-bearing.
 */
export function loadLayout(storage: StorageLike | undefined): LayoutState {
  if (!storage) return { ...LAYOUT_DEFAULTS };
  let raw: string | null = null;
  try {
    raw = storage.getItem(LAYOUT_KEY);
  } catch {
    return { ...LAYOUT_DEFAULTS };
  }
  if (!raw) return { ...LAYOUT_DEFAULTS };
  try {
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return clampLayout({
      sidebarW: typeof parsed.sidebarW === 'number' ? parsed.sidebarW : LAYOUT_DEFAULTS.sidebarW,
      consoleH: typeof parsed.consoleH === 'number' ? parsed.consoleH : LAYOUT_DEFAULTS.consoleH,
      previewW: typeof parsed.previewW === 'number' ? parsed.previewW : LAYOUT_DEFAULTS.previewW,
      aiChatW: typeof parsed.aiChatW === 'number' ? parsed.aiChatW : LAYOUT_DEFAULTS.aiChatW,
      sidebarCollapsed:
        typeof parsed.sidebarCollapsed === 'boolean'
          ? parsed.sidebarCollapsed
          : LAYOUT_DEFAULTS.sidebarCollapsed,
      consoleCollapsed:
        typeof parsed.consoleCollapsed === 'boolean'
          ? parsed.consoleCollapsed
          : LAYOUT_DEFAULTS.consoleCollapsed,
      aiChatOpen:
        typeof parsed.aiChatOpen === 'boolean' ? parsed.aiChatOpen : LAYOUT_DEFAULTS.aiChatOpen,
      view: isView(parsed.view) ? parsed.view : LAYOUT_DEFAULTS.view,
    });
  } catch {
    return { ...LAYOUT_DEFAULTS };
  }
}

/** Persist layout. Swallows quota/private-mode failures (never throws upstream). */
export function saveLayout(storage: StorageLike | undefined, state: LayoutState): void {
  if (!storage) return;
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(state));
  } catch {
    // private mode / quota — layout persistence is best-effort.
  }
}
