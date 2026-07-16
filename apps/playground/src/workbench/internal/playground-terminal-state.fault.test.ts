import { describe, expect, it, vi } from 'vitest';
import {
  ownPlaygroundProjectOpenOptions,
  ownProjectTerminalSnapshot,
  projectTerminalStateFromOwner,
  projectTerminalStateToOwner,
} from './playground-terminal-state.ts';

const PROJECT_ROOT = '/.rifty/workbench/projects/terminal-state';

describe('Playground terminal state boundary', () => {
  it('corrupt-input fault: accepts only exact data-property open options', () => {
    const owned = ownPlaygroundProjectOpenOptions({
      initialTerminalState: { cwd: '/', env: { KEEP: 'yes' } },
    });
    expect(owned).toEqual({ initialTerminalState: { cwd: '/', env: { KEEP: 'yes' } } });
    expect(Object.isFrozen(owned)).toBe(true);

    expect(() =>
      ownPlaygroundProjectOpenOptions({
        initialTerminalState: { cwd: '/', env: {} },
        ownerToken: 'leak',
      }),
    ).toThrow(TypeError);
    const read = vi.fn(() => ({ cwd: '/', env: {} }));
    const accessor = Object.defineProperty({}, 'initialTerminalState', {
      enumerable: true,
      get: read,
    });
    expect(() => ownPlaygroundProjectOpenOptions(accessor)).toThrow(TypeError);
    expect(read).not.toHaveBeenCalled();
  });

  it('corrupt-input fault: owns one exact frozen project-rooted cwd/env value', () => {
    const env = { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' };
    const input = { cwd: '/src', env };

    const owned = ownProjectTerminalSnapshot(input);
    env.PATH = '/mutated';
    input.cwd = '/mutated';

    expect(owned).toEqual({
      cwd: '/src',
      env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
    });
    expect(Object.isFrozen(owned)).toBe(true);
    expect(Object.isFrozen(owned.env)).toBe(true);
  });

  it.each([
    ['unknown snapshot key', { cwd: '/', env: {}, ownerToken: 'leak' }],
    ['relative cwd', { cwd: 'src', env: {} }],
    ['trailing slash', { cwd: '/src/', env: {} }],
    ['dot segment', { cwd: '/src/./nested', env: {} }],
    ['parent segment', { cwd: '/src/../outside', env: {} }],
    ['reserved owner metadata', { cwd: '/.rifty/private', env: {} }],
    ['array env', { cwd: '/', env: [] }],
    ['non-string env value', { cwd: '/', env: { PORT: 3000 } }],
    ['empty env key', { cwd: '/', env: { '': 'value' } }],
  ])('corrupt-input fault: rejects %s before it can become terminal state', (_label, value) => {
    expect(() => ownProjectTerminalSnapshot(value)).toThrow(TypeError);
  });

  it('corrupt-input fault: rejects accessors, symbols, and custom prototypes without reading them', () => {
    const read = vi.fn(() => '/');
    const accessor = Object.defineProperty({ env: {} }, 'cwd', {
      enumerable: true,
      get: read,
    });
    expect(() => ownProjectTerminalSnapshot(accessor)).toThrow(TypeError);
    expect(read).not.toHaveBeenCalled();

    const symbol = { cwd: '/', env: {}, [Symbol('owner')]: 'hidden' };
    expect(() => ownProjectTerminalSnapshot(symbol)).toThrow(TypeError);

    const custom = Object.assign(Object.create({ inherited: true }), { cwd: '/', env: {} });
    expect(() => ownProjectTerminalSnapshot(custom)).toThrow(TypeError);
  });

  it('provenance-lie fault: maps a reachable public cwd to the exact owner root', () => {
    const isDirectory = vi.fn((path: string) => path === `${PROJECT_ROOT}/src/nested`);
    const state = ownProjectTerminalSnapshot({ cwd: '/src/nested', env: { TERM: 'xterm' } });

    const owner = projectTerminalStateToOwner(PROJECT_ROOT, state, isDirectory);

    expect(isDirectory).toHaveBeenCalledWith(`${PROJECT_ROOT}/src/nested`);
    expect(owner).toEqual({ cwd: `${PROJECT_ROOT}/src/nested`, env: { TERM: 'xterm' } });
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Object.isFrozen(owner.env)).toBe(true);
  });

  it('provenance-lie fault: stale cwd falls back to project root while preserving env', () => {
    const state = ownProjectTerminalSnapshot({ cwd: '/deleted', env: { KEEP: 'yes' } });

    const owner = projectTerminalStateToOwner(PROJECT_ROOT, state, () => false);

    expect(owner).toEqual({ cwd: PROJECT_ROOT, env: { KEEP: 'yes' } });
  });

  it('provenance-lie fault: translates exact owner cwd back and rejects every escape', () => {
    expect(
      projectTerminalStateFromOwner(PROJECT_ROOT, {
        cwd: `${PROJECT_ROOT}/src`,
        env: { AFTER: 'run' },
      }),
    ).toEqual({ cwd: '/src', env: { AFTER: 'run' } });
    expect(projectTerminalStateFromOwner(PROJECT_ROOT, { cwd: PROJECT_ROOT, env: {} })).toEqual({
      cwd: '/',
      env: {},
    });

    for (const cwd of [
      '/.rifty/workbench/projects/terminal-state-other',
      '/.rifty/workbench/projects/outside',
      `${PROJECT_ROOT}/../outside`,
    ]) {
      expect(() => projectTerminalStateFromOwner(PROJECT_ROOT, { cwd, env: {} })).toThrow(
        /outside|Invalid project path/,
      );
    }
  });
});
