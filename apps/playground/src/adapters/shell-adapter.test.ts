/**
 * Unit tests for `useShellSession` (M10 Tier 0 wiring).
 *
 * Coverage:
 *   - `attachWriter` routes shell stdout/stderr chunks to the attached
 *     callback in real time (this is the streaming contract that lets the
 *     terminal show `npm install` progress without the empty-then-flood
 *     experience the sync `+=` writer produced).
 *   - `runLine` returns the shell exit code so callers can decide whether to
 *     repaint a red prompt.
 *   - Empty input is a no-op (no writer call) so the prompt can be rendered
 *     without round-tripping through the shell state machine.
 *
 * The hook calls `onCleanup` which only resolves inside a Solid reactive
 * root; tests wrap each construction with `createRoot` to provide one.
 */
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { useShellSession } from './shell-adapter.ts';

interface WriterChunk {
  readonly chunk: string;
  readonly stream: 'stdout' | 'stderr' | undefined;
}

function makeWriter(): {
  write: (chunk: string, stream?: 'stdout' | 'stderr') => void;
  calls: WriterChunk[];
} {
  const calls: WriterChunk[] = [];
  return {
    calls,
    write(chunk: string, stream?: 'stdout' | 'stderr'): void {
      calls.push({ chunk, stream });
    },
  };
}

describe('useShellSession', () => {
  it('routes stdout chunks to the attached writer in real time', async () => {
    await createRoot(async (dispose) => {
      const session = useShellSession();
      const writer = makeWriter();
      session.attachWriter(writer.write);
      const exitCode = await session.runLine('echo hello world');
      expect(exitCode).toBe(0);
      // The shell's `echo` builtin emits exactly one stdout chunk:
      // `hello world\n`. The writer must have seen it.
      expect(writer.calls).toEqual([{ chunk: 'hello world\n', stream: 'stdout' }]);
      dispose();
    });
  });

  it('routes stderr chunks separately from stdout', async () => {
    await createRoot(async (dispose) => {
      const session = useShellSession();
      const writer = makeWriter();
      session.attachWriter(writer.write);
      // Unknown command: shell writes a "not found" line to stderr, exit 127.
      const exitCode = await session.runLine('definitely-not-a-command');
      expect(exitCode).toBe(127);
      expect(writer.calls).toHaveLength(1);
      expect(writer.calls[0]?.stream).toBe('stderr');
      expect(writer.calls[0]?.chunk).toMatch(/definitely-not-a-command/);
      dispose();
    });
  });

  it('does nothing for empty input (no writer calls)', async () => {
    await createRoot(async (dispose) => {
      const session = useShellSession();
      const writer = makeWriter();
      session.attachWriter(writer.write);
      const exitCode = await session.runLine('   ');
      expect(exitCode).toBe(0);
      expect(writer.calls).toHaveLength(0);
      dispose();
    });
  });

  it('streams chunks across an && chain in order', async () => {
    // Locks in that the adapter forwards every per-segment chunk through the
    // same writer in arrival order, matching the streaming contract callers
    // expect for `cd app && npm install` style lines.
    await createRoot(async (dispose) => {
      const session = useShellSession({ cwd: '/' });
      const writer = makeWriter();
      session.attachWriter(writer.write);
      const exitCode = await session.runLine('echo first && echo second');
      expect(exitCode).toBe(0);
      const stdoutChunks = writer.calls
        .filter((c) => c.stream === 'stdout')
        .map((c) => c.chunk)
        .join('');
      expect(stdoutChunks).toBe('first\nsecond\n');
      dispose();
    });
  });

  it('cwd() reflects builtin `cd` changes between runLine calls', async () => {
    await createRoot(async (dispose) => {
      const session = useShellSession({ cwd: '/' });
      session.attachWriter(() => {});
      await session.runLine('mkdir -p /home');
      expect(session.cwd()).toBe('/');
      const exitCode = await session.runLine('cd /home');
      expect(exitCode).toBe(0);
      expect(session.cwd()).toBe('/home');
      dispose();
    });
  });

  it('env() reflects persistent shell env without exposing mutation', async () => {
    await createRoot(async (dispose) => {
      const session = useShellSession({ env: { FOO: 'bar' } });
      await session.runLine('NEXT=one');
      const snapshot = session.env();
      expect(snapshot).toEqual({ FOO: 'bar', NEXT: 'one' });
      snapshot.NEXT = 'mutated';
      expect(session.env().NEXT).toBe('one');
      dispose();
    });
  });

  it('routes raw terminal input to the active shell run stdin', async () => {
    await createRoot(async (dispose) => {
      const session = useShellSession();
      const writer = makeWriter();
      session.attachWriter(writer.write);
      session.registerCommand('read-one', async (_args, ctx) => {
        const chunk = await ctx.stdin?.read();
        ctx.stdout.write(chunk ? new TextDecoder().decode(chunk) : '<eof>');
        return 0;
      });

      const run = session.runLine('read-one');
      await Promise.resolve();
      session.writeStdin('\x1b[<0;10;20M');
      await expect(run).resolves.toBe(0);

      expect(writer.calls).toContainEqual({
        chunk: '\x1b[<0;10;20M',
        stream: 'stdout',
      });
      dispose();
    });
  });
});
