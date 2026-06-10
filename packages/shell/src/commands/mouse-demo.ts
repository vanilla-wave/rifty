import type { ShellCommand } from '../types.ts';

const ENABLE = '\x1b[?1000h\x1b[?1006h';
const DISABLE = '\x1b[?1006l\x1b[?1000l';

export const mouseDemo: ShellCommand = async (_args, ctx) => {
  if (!ctx.isTTY || !ctx.stdin) {
    ctx.stderr.write('mouse-demo: interactive stdin required\n');
    return 1;
  }
  ctx.stdout.write(ENABLE);
  const chunk = await ctx.stdin.read();
  ctx.stdout.write(DISABLE);
  if (!chunk) {
    ctx.stderr.write('mouse-demo: no input\n');
    return 1;
  }
  ctx.stdout.write(`mouse ${escapeBytes(chunk)}\n`);
  return 0;
};

function escapeBytes(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    if (byte === 0x1b) out += '\\x1b';
    else if (byte === 0x0d) out += '\\r';
    else if (byte === 0x0a) out += '\\n';
    else if (byte >= 0x20 && byte <= 0x7e) out += String.fromCharCode(byte);
    else out += `\\x${byte.toString(16).padStart(2, '0')}`;
  }
  return out;
}
