import { describe, expect, it } from 'vitest';
import { persistedProjectTerminalState } from './playground-terminal-state.ts';

describe('Playground host terminal-state migration', () => {
  it('keeps a versioned project-rooted cwd and opaque guest env', () => {
    const env = { PATH: '/bin', RIFTY_OWNER_TOKEN: 'guest-owned' };
    const state = persistedProjectTerminalState({
      source: 'project-rooted',
      state: { cwd: '/src/nested', env },
    });
    env.PATH = '/mutated';

    expect(state).toEqual({
      cwd: '/src/nested',
      env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'guest-owned' },
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.env)).toBe(true);
  });

  it.each([
    ['/workspaces/legacy-tab', '/'],
    ['/workspaces/legacy-tab/src', '/src'],
    ['/workspaces/legacy-tab/src/nested', '/src/nested'],
  ])('converts selected legacy cwd %s to %s', (cwd, expected) => {
    expect(
      persistedProjectTerminalState({
        source: 'legacy-absolute',
        legacyWorkspacePrefix: '/workspaces/legacy-tab',
        state: { cwd, env: { KEEP: 'yes' } },
      }),
    ).toEqual({ cwd: expected, env: { KEEP: 'yes' } });
  });

  it.each([
    ['/workspaces/other/src', '/workspaces/legacy-tab'],
    ['/workspaces/legacy-tab-other/src', '/workspaces/legacy-tab'],
    ['/workspace', '/workspaces/legacy-tab'],
    ['/src', '/workspaces/legacy-tab'],
    ['/workspaces/legacy-tab/src/../escape', '/workspaces/legacy-tab'],
    ['/workspaces/legacy-tab/src', undefined],
  ])('resets outside, malformed, or unprovable legacy cwd %s', (cwd, legacyWorkspacePrefix) => {
    expect(
      persistedProjectTerminalState({
        source: 'legacy-absolute',
        ...(legacyWorkspacePrefix === undefined ? {} : { legacyWorkspacePrefix }),
        state: { cwd, env: { KEEP: 'yes' } },
      }),
    ).toEqual({ cwd: '/', env: { KEEP: 'yes' } });
  });

  it.each(['/src/', '/src/../escape', '/.rifty/private'])(
    'resets malformed project-rooted cwd %s while preserving env',
    (cwd) => {
      expect(
        persistedProjectTerminalState({
          source: 'project-rooted',
          state: { cwd, env: { KEEP: 'yes' } },
        }),
      ).toEqual({ cwd: '/', env: { KEEP: 'yes' } });
    },
  );
});
