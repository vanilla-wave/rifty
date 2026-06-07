import { setSyncMirror } from '@riftydev/vfs/internal';
import { MemoryFsSync } from '@riftydev/vfs/internal';
/**
 * `CommandContext` cancellation + TTY shape (ADR-0089).
 *
 * Parity tier: unit-only-justified — the SIGINT-resolves-`run` contract and the
 * isTTY-per-sink rule have NO `node:*` oracle (Node ships no `Shell.run`) and no
 * GNU output to freeze; the dispatcher behavior IS the contract (ADR-0093 tiers
 * a/b/c all inapplicable). The relationship to Q-2026-06-05-317 (kernel worker
 * teardown) is a COMPLEMENTARY, SEPARATE decision — cooperative shell-side abort
 * vs kernel teardown — and is NOT subsumed by it (recorded in CHANGELOG).
 */
import { describe, expect, it, vi } from 'vitest';
import { Shell } from '../src/shell.ts';
import type { CommandContext } from '../src/types.ts';

describe('Shell.run — SIGINT cancellation contract (ADR-0089)', () => {
  it('resolves exit 130 when the host signal fires, even if the command NEVER returns', async () => {
    const sh = new Shell();
    sh.registerCommand('hang', () => new Promise<number>(() => {})); // never resolves
    const controller = new AbortController();
    const run = sh.run('hang', { signal: controller.signal });
    controller.abort(); // listener is attached synchronously before run's first await
    await expect(run).resolves.toMatchObject({ exitCode: 130 });
  });

  it('a command that OBSERVES ctx.signal can return early with 130', async () => {
    const sh = new Shell();
    sh.registerCommand('sleepy', (_args, ctx) => {
      return new Promise<number>((resolve) => {
        if (ctx.signal?.aborted) return resolve(130);
        ctx.signal?.addEventListener('abort', () => resolve(130), { once: true });
      });
    });
    const controller = new AbortController();
    const run = sh.run('sleepy', { signal: controller.signal });
    controller.abort();
    const r = await run;
    expect(r.exitCode).toBe(130);
  });

  it('an already-aborted host signal resolves 130 without hanging', async () => {
    const sh = new Shell();
    sh.registerCommand('hang', () => new Promise<number>(() => {}));
    const r = await sh.run('hang', { signal: AbortSignal.abort() });
    expect(r.exitCode).toBe(130);
  });

  it('SIGINT stops the rest of a compound chain', async () => {
    const sh = new Shell();
    let secondRan = false;
    sh.registerCommand(
      'first',
      (_a, ctx) =>
        new Promise<number>((resolve) => ctx.signal?.addEventListener('abort', () => resolve(130))),
    );
    sh.registerCommand('second', async () => {
      secondRan = true;
      return 0;
    });
    const controller = new AbortController();
    const run = sh.run('first ; second', { signal: controller.signal });
    controller.abort();
    await run;
    expect(secondRan).toBe(false);
  });

  it('removes its abort listener on a clean (non-aborted) settle — no leak', async () => {
    const sh = new Shell();
    sh.registerCommand('quick', async () => 0);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await sh.run('quick', { signal: controller.signal });
    expect(remove).toHaveBeenCalled(); // run() cleaned up its forward-abort listener
  });

  it('omitting signal preserves the legacy non-cancellable behavior', async () => {
    const sh = new Shell();
    const r = await sh.run('echo hi');
    expect(r).toMatchObject({ exitCode: 0, stdout: 'hi\n' });
  });
});

describe('CommandContext.isTTY per sink (ADR-0089 §56/§94)', () => {
  function probeShell(): { sh: Shell; seen: () => CommandContext | null } {
    const sh = new Shell({ cwd: '/' });
    let last: CommandContext | null = null;
    sh.registerCommand('probe', async (_args, ctx) => {
      last = ctx;
      ctx.stdout.write('x'); // some output so the redirect path engages
      return 0;
    });
    return { sh, seen: () => last };
  }

  it('a non-redirected segment gets ctx.isTTY = options.isTTY', async () => {
    const { sh, seen } = probeShell();
    await sh.run('probe', { isTTY: true, cols: 120, rows: 40 });
    expect(seen()?.isTTY).toBe(true);
    expect(seen()?.cols).toBe(120);
    expect(seen()?.rows).toBe(40);
  });

  it('defaults isTTY to false when the host does not say (color-safe default)', async () => {
    const { sh, seen } = probeShell();
    await sh.run('probe');
    expect(seen()?.isTTY).toBe(false);
  });

  it('the REDIRECT path forces ctx.isTTY false even when the host says TTY (§94)', async () => {
    setSyncMirror(new MemoryFsSync());
    const { sh, seen } = probeShell();
    await sh.run('probe > /out.txt', { isTTY: true });
    expect(seen()?.isTTY).toBe(false); // a file sink is never a TTY → SGR must be suppressed
  });
});
