/**
 * Test helper: build a {@link CommandContext} that captures stdout/stderr into
 * strings. `cwd` defaults to '/', `env` to {}; `over` shallow-merges on top.
 */

import type { CommandContext } from '../src/types.ts';

export function makeCtx(over: Partial<CommandContext> = {}): {
  ctx: CommandContext;
  out: () => string;
  err: () => string;
} {
  let outBuf = '';
  let errBuf = '';
  const ctx: CommandContext = {
    cwd: '/',
    env: {},
    stdout: {
      write(s) {
        outBuf += s;
      },
    },
    stderr: {
      write(s) {
        errBuf += s;
      },
    },
    ...over,
  };
  return { ctx, out: () => outBuf, err: () => errBuf };
}
