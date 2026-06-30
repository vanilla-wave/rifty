import { describe, expect, it } from 'vitest';
import {
  type EditorTab,
  closeTab,
  initialTabs,
  nextActiveAfterClose,
  openDiffTab,
  openFileTab,
  setDirty,
} from './editor-tabs.ts';

describe('initialTabs', () => {
  it('starts with ordered ordinary file tabs, no program tab', () => {
    const tabs = initialTabs([
      { path: '/workspace/src/main.js', title: 'src/main.js' },
      { path: '/workspace/src/project.js', title: 'project.js' },
    ]);
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toMatchObject({
      id: '/workspace/src/main.js',
      kind: 'file',
      path: '/workspace/src/main.js',
      dirty: false,
    });
    expect(tabs[1]).toMatchObject({
      id: '/workspace/src/project.js',
      kind: 'file',
      path: '/workspace/src/project.js',
      dirty: false,
    });
  });
});

describe('openFileTab', () => {
  it('appends a file tab keyed by path', () => {
    const tabs = openFileTab(initialTabs(), '/workspace/a.js', 'a.js');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ id: '/workspace/a.js', kind: 'file', path: '/workspace/a.js' });
  });

  it('is idempotent for an already-open path', () => {
    const once = openFileTab(initialTabs(), '/workspace/a.js', 'a.js');
    const twice = openFileTab(once, '/workspace/a.js', 'a.js');
    expect(twice).toHaveLength(1);
  });
});

describe('openDiffTab', () => {
  it('appends an idempotent diff tab keyed by the compared path/ref', () => {
    const tabs = openDiffTab(initialTabs(), {
      id: 'diff:HEAD:/workspace/src/main.ts',
      path: '/workspace/src/main.ts',
      title: 'main.ts ↔ HEAD',
      originalTitle: 'HEAD',
      modifiedTitle: 'main.ts',
    });

    expect(tabs[0]).toMatchObject({
      id: 'diff:HEAD:/workspace/src/main.ts',
      kind: 'diff',
      path: '/workspace/src/main.ts',
      dirty: false,
    });
    expect(openDiffTab(tabs, tabs[0] as Extract<EditorTab, { kind: 'diff' }>)).toHaveLength(1);
  });
});

describe('closeTab', () => {
  it('removes a file tab', () => {
    const tabs = openFileTab(initialTabs(), '/workspace/a.js', 'a.js');
    expect(closeTab(tabs, '/workspace/a.js')).toHaveLength(0);
  });
});

describe('nextActiveAfterClose', () => {
  const tabs: EditorTab[] = [
    { id: '/a.js', kind: 'file', title: 'a', path: '/a.js', dirty: false },
    { id: '/b.js', kind: 'file', title: 'b', path: '/b.js', dirty: false },
  ];

  it('keeps the active tab when closing an inactive one', () => {
    expect(nextActiveAfterClose(tabs, '/a.js', '/b.js')).toBe('/b.js');
  });

  it('falls to the right neighbour when closing the active tab', () => {
    expect(nextActiveAfterClose(tabs, '/a.js', '/a.js')).toBe('/b.js');
  });

  it('falls to the left neighbour or no active tab when closing the last tab', () => {
    expect(nextActiveAfterClose(tabs, '/b.js', '/b.js')).toBe('/a.js');
    expect(nextActiveAfterClose(tabs.slice(0, 1), '/a.js', '/a.js')).toBeUndefined();
  });
});

describe('setDirty', () => {
  it('flags a file tab dirty and clears it', () => {
    const tabs = openFileTab(initialTabs(), '/a.js', 'a');
    expect(setDirty(tabs, '/a.js', true)[0]?.dirty).toBe(true);
    expect(setDirty(setDirty(tabs, '/a.js', true), '/a.js', false)[0]?.dirty).toBe(false);
  });

  it('never marks a diff tab dirty', () => {
    const tabs = openDiffTab(initialTabs(), {
      id: 'diff:HEAD:/a.js',
      path: '/a.js',
      title: 'a.js ↔ HEAD',
      originalTitle: 'HEAD',
      modifiedTitle: 'a.js',
    });
    expect(setDirty(tabs, 'diff:HEAD:/a.js', true)[0]?.dirty).toBe(false);
  });
});
