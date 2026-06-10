import type { ShellCommand } from '../types.ts';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const PNG_1X1_PADDING = PNG_1X1.endsWith('==') ? 2 : PNG_1X1.endsWith('=') ? 1 : 0;
const PNG_1X1_SIZE = (PNG_1X1.length / 4) * 3 - PNG_1X1_PADDING;

export const img: ShellCommand = async (_args, ctx) => {
  if (!ctx.isTTY) return 0;
  ctx.stdout.write(`${ESC}]1337;File=inline=1;size=${PNG_1X1_SIZE}:${PNG_1X1}${BEL}`);
  return 0;
};
