import { NODE_PROCESS_IDENTITY } from '@riftydev/runtime-js/builtins/process-identity';
import { describe, expect, it } from 'vitest';
import { terminalWelcomeBanner } from './terminal-welcome-banner.ts';

describe('terminalWelcomeBanner', () => {
  it('is two lines: a version line + a dim "try:" hint line', () => {
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

  it('line 2 suggests reflexive first moves', () => {
    expect(terminalWelcomeBanner).toContain('node -v');
    expect(terminalWelcomeBanner).toContain('npm install chalk');
    expect(terminalWelcomeBanner).toContain('help');
  });

  it('carries no trailing newline (the prompt adds its own separator)', () => {
    expect(terminalWelcomeBanner.endsWith('\n')).toBe(false);
  });

  it('does not over-claim Node compatibility', () => {
    expect(terminalWelcomeBanner.toLowerCase()).not.toContain('fully compatible');
    expect(terminalWelcomeBanner.toLowerCase()).not.toContain('full node');
  });
});
