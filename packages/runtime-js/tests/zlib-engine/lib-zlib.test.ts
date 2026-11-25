/**
 * Unit 2 Acceptance 2, differential half (ADR-0573): lib-zlib-diff.mjs in its own Node process
 * (`--expose-internals` for Node's `primordials`/`internalBinding`) — Node's verbatim lib/zlib.js
 * over the product handle and Node's `Transform` equals real `node:zlib` on every scenario; values
 * compared whole (bytes by hash, errors by class, code, errno, message; the gzip OS byte normalised).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./lib-zlib-diff.mjs', import.meta.url));

describe("Node's own lib/zlib.js over the product handle (port/N) vs node:zlib", () => {
  it(
    'state group 45/45 and load group 1/1 equal Node; the declared snapshot limit pinned',
    { timeout: 120_000 },
    () => {
      const out = execFileSync(
        process.execPath,
        ['--expose-internals', '--import', 'tsx', SCRIPT],
        {
          encoding: 'utf8',
          maxBuffer: 64 << 20,
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      const { builtin, results } = JSON.parse(out) as {
        builtin: boolean;
        results: Record<string, { group: string; node: unknown; 'port/N': unknown }>;
      };
      expect(builtin, 'fixture lib/zlib.js = the running Node builtin source').toBe(true);
      const groups: Record<string, number> = {};
      const diffs: string[] = [];
      for (const [name, r] of Object.entries(results)) {
        groups[r.group] = (groups[r.group] ?? 0) + 1;
        if (r.group !== 'declared' && JSON.stringify(r.node) !== JSON.stringify(r['port/N']))
          diffs.push(`${name}: ${JSON.stringify(r.node)} → ${JSON.stringify(r['port/N'])}`);
      }
      expect(groups).toEqual({ state: 45, load: 1, declared: 2 });
      expect(diffs).toEqual([]);
      // Declared limit: input snapshotted for the whole write (Node reads it live). Both sides pinned.
      const declared = Object.fromEntries(
        Object.entries(results)
          .filter(([, r]) => r.group === 'declared')
          .map(([name, r]) => [name, { node: r.node, port: r['port/N'] }]),
      );
      expect(declared).toEqual({
        'declared: inflate input changed in the first data event': {
          node: {
            error: {
              error: 'Error',
              code: 'Z_BUF_ERROR',
              errno: -5,
              message: 'unexpected end of file',
            },
          },
          port: { end: '202000:6d299b2a3e71368c', plain: true },
        },
        'declared: level-0 deflate input changed in the first data event': {
          node: { bytes: 200000, A: 134464 },
          port: { bytes: 200000, A: 0 },
        },
      });
    },
  );
});
