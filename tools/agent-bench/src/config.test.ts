import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, TASK_SET_VERSION, loadConfig, parseConfig } from './config.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempConfigFile(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-bench-config-'));
  tempDirs.push(dir);
  const path = join(dir, 'bench.json');
  writeFileSync(path, JSON.stringify(json), 'utf8');
  return path;
}

describe('parseConfig', () => {
  it('applies defaults on an empty config', () => {
    const config = parseConfig({}, {});
    expect(config.endpoint).toBeNull();
    expect(config.limits).toEqual(DEFAULT_LIMITS);
    expect(config.runsPerTask).toBe(3);
    expect(config.playgroundPort).toBe(5273);
    expect(config.taskSetVersion).toBe(TASK_SET_VERSION);
  });

  it('respects RIFTY_PLAYGROUND_PORT', () => {
    const config = parseConfig({}, { RIFTY_PLAYGROUND_PORT: '6001' });
    expect(config.playgroundPort).toBe(6001);
  });

  it('explicit playgroundPort beats the env var', () => {
    const config = parseConfig({ playgroundPort: 7000 }, { RIFTY_PLAYGROUND_PORT: '6001' });
    expect(config.playgroundPort).toBe(7000);
  });

  it('parses endpoint with envKey defaulting to OPENAI_API_KEY', () => {
    const config = parseConfig(
      { endpoint: { baseUrl: 'https://api.example.com/v1', model: 'gpt-x' } },
      {},
    );
    expect(config.endpoint).toEqual({
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-x',
      envKey: 'OPENAI_API_KEY',
    });
  });

  it('keeps a custom envKey (name only, never a key value)', () => {
    const config = parseConfig(
      { endpoint: { baseUrl: 'https://x/v1', model: 'm', envKey: 'BENCH_KEY' } },
      {},
    );
    expect(config.endpoint?.envKey).toBe('BENCH_KEY');
  });

  it('merges partial limits over defaults', () => {
    const config = parseConfig({ limits: { maxToolCalls: 7 } }, {});
    expect(config.limits).toEqual({ ...DEFAULT_LIMITS, maxToolCalls: 7 });
  });

  it('rejects unknown top-level keys loudly', () => {
    expect(() => parseConfig({ endpoints: {} }, {})).toThrow(/unknown key endpoints/);
  });

  it('rejects unknown limit keys loudly', () => {
    expect(() => parseConfig({ limits: { maxTurns: 5 } }, {})).toThrow(
      /unknown key limits\.maxTurns/,
    );
  });

  it('rejects non-integer runsPerTask', () => {
    expect(() => parseConfig({ runsPerTask: 1.5 }, {})).toThrow(/runsPerTask/);
    expect(() => parseConfig({ runsPerTask: 0 }, {})).toThrow(/runsPerTask/);
  });

  it('rejects a bad RIFTY_PLAYGROUND_PORT', () => {
    expect(() => parseConfig({}, { RIFTY_PLAYGROUND_PORT: 'abc' })).toThrow(
      /RIFTY_PLAYGROUND_PORT/,
    );
  });
});

describe('loadConfig', () => {
  it('loads a config file', () => {
    const path = tempConfigFile({
      endpoint: { baseUrl: 'https://x/v1', model: 'm' },
      runsPerTask: 1,
    });
    const config = loadConfig(path, {});
    expect(config.endpoint?.model).toBe('m');
    expect(config.runsPerTask).toBe(1);
  });

  it('throws on a missing file', () => {
    expect(() => loadConfig('/nonexistent/bench.json', {})).toThrow(/cannot read/);
  });

  it('throws on invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-bench-config-'));
    tempDirs.push(dir);
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{nope', 'utf8');
    expect(() => loadConfig(path, {})).toThrow(/not valid JSON/);
  });
});
