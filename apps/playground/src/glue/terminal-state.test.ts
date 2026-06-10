import { describe, expect, it } from 'vitest';
import {
  TERMINAL_STATE_PATH,
  type TerminalStateFs,
  type TerminalStateVfs,
  loadTerminalState,
  loadTerminalStateAsync,
  saveTerminalState,
  saveTerminalStateAsync,
} from './terminal-state.ts';

function fakeFs(): TerminalStateFs {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set(['/']);
  return {
    existsSync: (path) => files.has(path) || dirs.has(path),
    readFileBytesSync: (path) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`ENOENT ${path}`);
      return bytes;
    },
    writeFileSync: (path, data) => {
      files.set(path, data);
    },
    mkdirSync: (path) => {
      dirs.add(path);
    },
  };
}

function fakeVfs(): TerminalStateVfs {
  const fs = fakeFs();
  return {
    readFile: async (path) => fs.readFileBytesSync(path),
    writeFile: async (path, data) => fs.writeFileSync(path, data),
    mkdir: async (path, options) => fs.mkdirSync(path, options),
  };
}

describe('terminal state store', () => {
  it('loads defaults when state is absent or malformed', () => {
    const fs = fakeFs();
    expect(loadTerminalState(fs, '/workspace')).toEqual({ cwd: '/workspace', env: {} });
    fs.mkdirSync('/workspace/.rifty', { recursive: true });
    fs.writeFileSync(TERMINAL_STATE_PATH, new TextEncoder().encode('{nope'));
    expect(loadTerminalState(fs, '/workspace')).toEqual({ cwd: '/workspace', env: {} });
  });

  it('round-trips cwd and string env', () => {
    const fs = fakeFs();
    saveTerminalState(fs, { cwd: '/workspace/app', env: { FOO: 'bar', N: '1' } });
    expect(loadTerminalState(fs, '/workspace')).toEqual({
      cwd: '/workspace/app',
      env: { FOO: 'bar', N: '1' },
    });
  });

  it('round-trips through an async VFS store', async () => {
    const fs = fakeVfs();
    await saveTerminalStateAsync(fs, { cwd: '/workspace/app', env: { FOO: 'bar' } });
    expect(await loadTerminalStateAsync(fs, '/workspace')).toEqual({
      cwd: '/workspace/app',
      env: { FOO: 'bar' },
    });
  });

  it('bounds saved env entries', () => {
    const fs = fakeFs();
    const env = {
      TOO_LONG: 'x'.repeat(8193),
      ...Object.fromEntries(
        Array.from({ length: 300 }, (_, index) => [`KEY_${index}`, String(index)]),
      ),
    };
    saveTerminalState(fs, { cwd: '/workspace/app', env });
    const loaded = loadTerminalState(fs, '/workspace');
    expect(Object.keys(loaded.env)).toHaveLength(256);
    expect(loaded.env.KEY_0).toBe('0');
    expect(loaded.env.KEY_255).toBe('255');
    expect(loaded.env.KEY_256).toBeUndefined();
    expect(loaded.env.TOO_LONG).toBeUndefined();
  });

  it('filters invalid env entries and relative cwd', () => {
    const fs = fakeFs();
    fs.mkdirSync('/workspace/.rifty', { recursive: true });
    fs.writeFileSync(
      TERMINAL_STATE_PATH,
      new TextEncoder().encode(JSON.stringify({ cwd: 'relative', env: { OK: 'yes', BAD: 1 } })),
    );
    expect(loadTerminalState(fs, '/workspace')).toEqual({
      cwd: '/workspace',
      env: { OK: 'yes' },
    });
  });
});
