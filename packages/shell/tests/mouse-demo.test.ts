import { describe, expect, it } from 'vitest';
import { Shell, mouseDemo } from '../src/index.ts';

describe('mouse-demo optional command', () => {
  function makeShell(): Shell {
    const shell = new Shell();
    shell.registerCommand('mouse-demo', mouseDemo);
    return shell;
  }

  it('enables SGR mouse reporting and prints escaped raw stdin bytes', async () => {
    const sh = makeShell();
    const chunks = [new TextEncoder().encode('\x1b[<0;10;20M')];

    const result = await sh.run('mouse-demo', {
      isTTY: true,
      stdin: {
        read: async () => chunks.shift() ?? null,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      '\x1b[?1000h\x1b[?1006h\x1b[?1006l\x1b[?1000lmouse \\x1b[<0;10;20M\n',
    );
  });

  it('fails cleanly without interactive stdin', async () => {
    const sh = makeShell();
    const result = await sh.run('mouse-demo');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('mouse-demo: interactive stdin required\n');
  });
});
