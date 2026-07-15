import type { CommandContext, ProcessExit, Shell } from '@riftydev/shell';

/** Execute one npm lifecycle body in its real nested Shell and preserve exact exit. */
export async function runNestedShellCommand(
  shell: Shell,
  command: string,
  ctx: CommandContext,
): Promise<ProcessExit> {
  try {
    const result = await shell.run(command, {
      onChunk: (chunk, stream) => {
        if (stream === 'stdout') ctx.stdout.write(chunk);
        else ctx.stderr.write(chunk);
      },
      signal: ctx.signal,
      isTTY: ctx.isTTY,
      cols: ctx.cols,
      rows: ctx.rows,
      stdin: ctx.stdin,
      terminal: ctx.terminal,
      awaitAbortSettlement: true,
    });
    return result.exit;
  } finally {
    await shell.dispose();
  }
}
