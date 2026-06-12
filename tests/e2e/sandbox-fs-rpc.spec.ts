import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * ADR-0131 acceptance: the public `RuntimeController.fs` round-trips through a
 * REAL runtime Worker — host client → postMessage → worker-entry 'fs' dispatch
 * → syncMirror → 'fs-result' → host. Both halves are unit-tested against fakes
 * of each other; this is the only place the actual transport runs.
 *
 * Loads host.ts and worker-entry.ts straight from source via Vite's `/@fs/`
 * dev-server transform (the playground itself spawns kernel workers, not this
 * runtime worker, so no UI flow covers it).
 */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

test.describe('ADR-0131 — sandbox fs RPC over a real Worker', () => {
  test('writeFile → readFile → eval-visible round-trip + serialized ENOENT', async ({ page }) => {
    await page.goto('/');
    // The playground reloads once while the SW takes control — wait for the
    // post-reload UI before creating an execution-context-bound evaluate.
    await expect(page.getByRole('button', { name: 'New terminal' })).toBeVisible({
      timeout: 30_000,
    });

    const result = await page.evaluate(
      async ({ root }) => {
        const hostMod = (await import(
          /* @vite-ignore */ `/@fs${root}/packages/runtime-js/src/host.ts`
        )) as {
          spawnRuntime: (opts: { workerUrl: string }) => {
            fs: {
              readFile(path: string, encoding: 'utf8'): Promise<string>;
              readFile(path: string): Promise<Uint8Array>;
              writeFile(path: string, data: string | Uint8Array): Promise<void>;
            };
            eval(code: string): Promise<{ ok: boolean }>;
            on(handler: (event: { type: string; chunk?: string }) => void): () => void;
            dispose(): void;
          };
        };
        const workerUrl = `/@fs${root}/packages/runtime-js/src/worker-entry.ts`;
        const runtime = hostMod.spawnRuntime({ workerUrl });
        try {
          const stdout: string[] = [];
          runtime.on((event) => {
            if (event.type === 'stdout' && event.chunk) stdout.push(event.chunk);
          });
          await runtime.fs.writeFile('/e2e/dir/probe.txt', 'rpc-bytes');
          const text = await runtime.fs.readFile('/e2e/dir/probe.txt', 'utf8');
          const bytes = await runtime.fs.readFile('/e2e/dir/probe.txt');
          // REPL eval posts the expression value to stdout (value stays undefined).
          const evalResult = await runtime.eval(
            `console.log('guest-sees:' + require('node:fs').readFileSync('/e2e/dir/probe.txt', 'utf8'))`,
          );
          let enoent: { name?: string; code?: string } | null = null;
          try {
            await runtime.fs.readFile('/e2e/missing.txt', 'utf8');
          } catch (err) {
            const e = err as Error & { code?: string };
            enoent = { name: e.name, code: e.code };
          }
          return {
            text,
            byteLength: bytes.byteLength,
            isUint8: bytes instanceof Uint8Array,
            evalOk: evalResult.ok,
            stdout: stdout.join(''),
            enoent,
          };
        } finally {
          runtime.dispose();
        }
      },
      { root: repoRoot },
    );

    expect(result.text).toBe('rpc-bytes');
    expect(result.isUint8).toBe(true);
    expect(result.byteLength).toBe('rpc-bytes'.length);
    // The write is visible to guest code through the SAME worker VFS — proves
    // the RPC hit the authoritative mirror, not a detached copy.
    expect(result.evalOk).toBe(true);
    expect(result.stdout).toContain('guest-sees:rpc-bytes');
    expect(result.enoent).toMatchObject({ code: 'ENOENT' });
  });
});
