import { describe, expect, it } from 'vitest';
import {
  LAYOUT_DEFAULTS,
  LAYOUT_KEY,
  type LayoutState,
  type StorageLike,
  clampLayout,
  loadLayout,
  saveLayout,
} from './layout-store.ts';

function fakeStorage(
  initial: Record<string, string> = {},
): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe('loadLayout', () => {
  it('returns defaults when storage is empty or absent', () => {
    expect(loadLayout(fakeStorage())).toEqual(LAYOUT_DEFAULTS);
    expect(loadLayout(undefined)).toEqual(LAYOUT_DEFAULTS);
  });

  it('defaults the preview pane wider than the original Soft Panels mockup', () => {
    expect(LAYOUT_DEFAULTS.previewW).toBeGreaterThan(464);
  });

  it('round-trips a saved layout', () => {
    const storage = fakeStorage();
    const state: LayoutState = {
      sidebarW: 300,
      consoleH: 260,
      previewW: 520,
      aiChatW: 420,
      sidebarCollapsed: true,
      consoleCollapsed: false,
      aiChatOpen: true,
      aiView: 'vibe',
      view: 'scm',
    };
    saveLayout(storage, state);
    expect(loadLayout(storage)).toEqual(state);
  });

  it('clamps a stale oversized value so a panel cannot strand off-screen', () => {
    const storage = fakeStorage({
      [LAYOUT_KEY]: JSON.stringify({ ...LAYOUT_DEFAULTS, sidebarW: 99999, consoleH: 1 }),
    });
    const loaded = loadLayout(storage);
    expect(loaded.sidebarW).toBe(560);
    expect(loaded.consoleH).toBe(120);
  });

  it('falls back to defaults on malformed JSON', () => {
    expect(loadLayout(fakeStorage({ [LAYOUT_KEY]: '{not json' }))).toEqual(LAYOUT_DEFAULTS);
  });

  it('ignores an invalid view value', () => {
    const storage = fakeStorage({ [LAYOUT_KEY]: JSON.stringify({ view: 'nope' }) });
    expect(loadLayout(storage).view).toBe(LAYOUT_DEFAULTS.view);
  });

  it('ignores an invalid aiView value and keeps a valid one', () => {
    expect(
      loadLayout(fakeStorage({ [LAYOUT_KEY]: JSON.stringify({ aiView: 'nope' }) })).aiView,
    ).toBe('chat');
    expect(
      loadLayout(fakeStorage({ [LAYOUT_KEY]: JSON.stringify({ aiView: 'vibe' }) })).aiView,
    ).toBe('vibe');
  });
});

describe('clampLayout', () => {
  it('leaves flags and view untouched', () => {
    const out = clampLayout({
      sidebarW: 9999,
      consoleH: 1,
      previewW: 9999,
      aiChatW: 9999,
      sidebarCollapsed: true,
      consoleCollapsed: true,
      aiChatOpen: true,
      aiView: 'vibe',
      view: 'scm',
    });
    expect(out).toMatchObject({
      sidebarCollapsed: true,
      consoleCollapsed: true,
      aiChatOpen: true,
      view: 'scm',
    });
    expect(out.aiChatW).toBe(720);
  });
});
