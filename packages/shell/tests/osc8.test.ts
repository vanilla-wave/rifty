import { expect, it } from 'vitest';
import { osc8FileLink } from '../src/commands/_osc8.ts';
import { makeCtx } from './_ctx.ts';

it('does not wrap file labels outside a TTY', () => {
  const { ctx } = makeCtx();

  expect(osc8FileLink('/workspace/src/main.js', 'src/main.js', ctx)).toBe('src/main.js');
});

it('wraps TTY file labels in OSC 8 with an encoded file URI', () => {
  const { ctx } = makeCtx({ isTTY: true });

  expect(osc8FileLink('/workspace/a file.js', 'a file.js', ctx)).toBe(
    '\x1b]8;;file:///workspace/a%20file.js\x07a file.js\x1b]8;;\x07',
  );
});
