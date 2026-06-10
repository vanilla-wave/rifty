import { describe, expect, it } from 'vitest';
import { detectTerminalQuickFix } from './terminal-quick-fix.ts';

describe('detectTerminalQuickFix', () => {
  it('detects command-not-found suggestions from shell stderr', () => {
    expect(detectTerminalQuickFix("grpe: command not found\nDid you mean 'grep'?\n")).toEqual({
      label: 'Run grep',
      command: 'grep',
    });
  });

  it('uses the latest suggestion in an accumulated stderr tail', () => {
    expect(
      detectTerminalQuickFix(
        "grpe: command not found\nDid you mean 'grep'?\nslpe: command not found\nDid you mean 'sleep'?\n",
      ),
    ).toEqual({
      label: 'Run sleep',
      command: 'sleep',
    });
  });

  it('returns null when stderr has no known quick fix', () => {
    expect(detectTerminalQuickFix('zzzzzzzz: command not found\n')).toBeNull();
  });

  it('detects address-in-use output using the last submitted command', () => {
    expect(
      detectTerminalQuickFix({
        stderr: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:3000\n',
        lastCommand: 'npm run dev',
      }),
    ).toEqual({
      label: 'Stop and rerun npm run dev',
      command: 'npm run dev',
      interruptBeforeRun: true,
    });
  });

  it('does not offer address-in-use fixes without a command to rerun', () => {
    expect(
      detectTerminalQuickFix({
        stderr: 'EADDRINUSE\n',
      }),
    ).toBeNull();
  });
});
