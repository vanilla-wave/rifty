import { describe, expect, it } from 'vitest';
import {
  type EditorTab,
  PROGRAM_TAB_ID,
  closeTab,
  initialTabs,
  nextActiveAfterClose,
  openFileTab,
  setDirty,
  setProgramTitle,
} from './editor-tabs.ts';

describe('initialTabs', () => {
  it('starts with the program tab at index 0, non-dirty', () => {
    const tabs = initialTabs('program · main.js');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ id: PROGRAM_TAB_ID, kind: 'program', dirty: false });
  });
});

describe('openFileTab', () => {
  it('appends a file tab keyed by path', () => {
    const tabs = openFileTab(initialTabs('p'), '/workspace/a.js', 'a.js');
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toMatchObject({ id: '/workspace/a.js', kind: 'file', path: '/workspace/a.js' });
  });

  it('is idempotent for an already-open path', () => {
    const once = openFileTab(initialTabs('p'), '/workspace/a.js', 'a.js');
    const twice = openFileTab(once, '/workspace/a.js', 'a.js');
    expect(twice).toHaveLength(2);
  });

  it('keeps the program tab first', () => {
    const tabs = openFileTab(initialTabs('p'), '/workspace/a.js', 'a.js');
    expect(tabs[0]?.id).toBe(PROGRAM_TAB_ID);
  });
});

describe('closeTab', () => {
  it('removes a file tab', () => {
    const tabs = openFileTab(initialTabs('p'), '/workspace/a.js', 'a.js');
    expect(closeTab(tabs, '/workspace/a.js')).toHaveLength(1);
  });

  it('never closes the program tab', () => {
    const tabs = initialTabs('p');
    expect(closeTab(tabs, PROGRAM_TAB_ID)).toHaveLength(1);
  });
});

describe('nextActiveAfterClose', () => {
  const tabs: EditorTab[] = [
    { id: PROGRAM_TAB_ID, kind: 'program', title: 'p', dirty: false },
    { id: '/a.js', kind: 'file', title: 'a', path: '/a.js', dirty: false },
    { id: '/b.js', kind: 'file', title: 'b', path: '/b.js', dirty: false },
  ];

  it('keeps the active tab when closing an inactive one', () => {
    expect(nextActiveAfterClose(tabs, '/a.js', '/b.js')).toBe('/b.js');
  });

  it('falls to the right neighbour when closing the active tab', () => {
    expect(nextActiveAfterClose(tabs, '/a.js', '/a.js')).toBe('/b.js');
  });

  it('falls to the left neighbour (program) when closing the last tab', () => {
    expect(nextActiveAfterClose(tabs, '/b.js', '/b.js')).toBe('/a.js');
    expect(nextActiveAfterClose(tabs.slice(0, 2), '/a.js', '/a.js')).toBe(PROGRAM_TAB_ID);
  });
});

describe('setDirty', () => {
  it('flags a file tab dirty and clears it', () => {
    const tabs = openFileTab(initialTabs('p'), '/a.js', 'a');
    expect(setDirty(tabs, '/a.js', true)[1]?.dirty).toBe(true);
    expect(setDirty(setDirty(tabs, '/a.js', true), '/a.js', false)[1]?.dirty).toBe(false);
  });

  it('never marks the program tab dirty', () => {
    const tabs = setDirty(initialTabs('p'), PROGRAM_TAB_ID, true);
    expect(tabs[0]?.dirty).toBe(false);
  });
});

describe('setProgramTitle', () => {
  it('relabels only the program tab', () => {
    const tabs = setProgramTitle(
      openFileTab(initialTabs('p'), '/a.js', 'a'),
      'program · src/main.js',
    );
    expect(tabs[0]?.title).toBe('program · src/main.js');
    expect(tabs[1]?.title).toBe('a');
  });
});
