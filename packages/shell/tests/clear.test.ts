import { NotImplementedError } from '@riftydev/io';
import { expect, it } from 'vitest';
import { clear } from '../src/commands/clear.ts';
import { makeCtx } from './_ctx.ts';

const ESC = String.fromCharCode(27);

it('TTY: emits cursor-home + clear-screen + clear-scrollback CSIs, exit 0', async () => {
  const { ctx, out, err } = makeCtx({ isTTY: true });
  const code = await clear([], ctx);
  expect(code).toBe(0);
  // The three sequences real `clear` emits: ESC[H (home), ESC[2J (screen), ESC[3J (scrollback).
  expect(out()).toContain(`${ESC}[H`);
  expect(out()).toContain(`${ESC}[2J`);
  expect(out()).toContain(`${ESC}[3J`);
  expect(err()).toBe('');
});

it('non-TTY: writes NOTHING (no control bytes into a file/pipe), exit 0', async () => {
  const { ctx, out, err } = makeCtx({ isTTY: false });
  const code = await clear([], ctx);
  expect(code).toBe(0);
  // isTTY-gated divergence from real `clear`: redirecting must not dump escapes.
  expect(out()).toBe('');
  expect(err()).toBe('');
});

it('isTTY absent: treated as non-TTY → empty stdout, exit 0', async () => {
  const { ctx, out } = makeCtx();
  const code = await clear([], ctx);
  expect(code).toBe(0);
  expect(out()).toBe('');
});

it('-T (a flag taking TERM) throws NotImplementedError, even on a TTY', async () => {
  const { ctx } = makeCtx({ isTTY: true });
  await expect(clear(['-T', 'xterm'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});

it('any unknown flag (-x) throws NotImplementedError', async () => {
  const { ctx } = makeCtx({ isTTY: true });
  await expect(clear(['-x'], ctx)).rejects.toBeInstanceOf(NotImplementedError);
});
