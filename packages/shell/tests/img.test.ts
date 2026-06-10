import { expect, it } from 'vitest';
import { img } from '../src/commands/img.ts';
import { makeCtx } from './_ctx.ts';

const BEL = String.fromCharCode(7);

it('TTY: emits an iTerm inline-image PNG sequence', async () => {
  const { ctx, out, err } = makeCtx({ isTTY: true });
  const code = await img([], ctx);
  expect(code).toBe(0);
  expect(out().startsWith('\x1b]1337;File=inline=1;size=')).toBe(true);
  expect(out()).toContain('iVBORw0KGgo');
  expect(out().endsWith(BEL)).toBe(true);
  expect(err()).toBe('');
});

it('non-TTY: writes nothing, exit 0', async () => {
  const { ctx, out, err } = makeCtx({ isTTY: false });
  const code = await img([], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('');
  expect(err()).toBe('');
});
