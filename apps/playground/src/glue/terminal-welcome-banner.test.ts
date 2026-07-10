import { NODE_PROCESS_IDENTITY } from '@riftydev/runtime-js/builtins/process-identity';
import { describe, expect, it } from 'vitest';
import { terminalWelcomeBanner } from './terminal-welcome-banner.ts';

describe('terminalWelcomeBanner', () => {
  it('is two lines: a version line + a dim shell-availability hint line', () => {
    const lines = terminalWelcomeBanner.split('\r\n');
    expect(lines).toHaveLength(2);
  });

  it('line 1 names rifty + the LIVE node version (no drifting hardcode)', () => {
    expect(terminalWelcomeBanner).toContain(
      `rifty · node ${NODE_PROCESS_IDENTITY.version} · npm in your browser`,
    );
    // The version is interpolated from the runtime identity, so it can't drift.
    expect(terminalWelcomeBanner).toContain(NODE_PROCESS_IDENTITY.version);
  });

  it('line 2 stays truthful when the current terminal is owned by a running program', () => {
    expect(terminalWelcomeBanner).toContain(
      'Use + to open another shell while a program is running',
    );
    expect(terminalWelcomeBanner).not.toContain('node -v');
    expect(terminalWelcomeBanner).not.toContain('npm install chalk');
  });

  it('carries no trailing newline (the prompt adds its own separator)', () => {
    expect(terminalWelcomeBanner.endsWith('\n')).toBe(false);
  });

  it('does not over-claim Node compatibility', () => {
    expect(terminalWelcomeBanner.toLowerCase()).not.toContain('fully compatible');
    expect(terminalWelcomeBanner.toLowerCase()).not.toContain('full node');
  });
});
