import { expect, it } from 'vitest';
import { createTerminalManager } from './terminal-session.ts';

it('exports a headless terminal session manager from workbench', async () => {
  const manager = createTerminalManager({
    cwd: '/',
    commands: {
      mark: async (_args, ctx) => {
        ctx.stdout.write(`session:${ctx.sessionId}\n`);
        return 0;
      },
    },
  });
  const session = manager.sessions()[0]!;
  const chunks: string[] = [];
  manager.attachWriter(session.id, (chunk) => chunks.push(chunk));

  await expect(manager.runLine(session.id, 'mark')).resolves.toBe(0);

  expect(chunks).toEqual([`session:${session.id}\n`]);
  manager.dispose();
});
