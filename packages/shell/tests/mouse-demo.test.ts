import { describe, expect, it } from 'vitest';
import { Shell } from '../src/index.ts';

describe('mouse-demo builtin', () => {
  it('enables SGR mouse reporting and prints escaped raw stdin bytes', async () => {
    const sh = new Shell();
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
    const sh = new Shell();
    const result = await sh.run('mouse-demo');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('mouse-demo: interactive stdin required\n');
  });
});
