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
  it('state group 45/45 and load group 1/1 equal Node', { timeout: 120_000 }, () => {
    const out = execFileSync(process.execPath, ['--expose-internals', '--import', 'tsx', SCRIPT], {
      encoding: 'utf8',
      maxBuffer: 64 << 20,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const { builtin, results } = JSON.parse(out) as {
      builtin: boolean;
      results: Record<string, { group: string; node: unknown; 'port/N': unknown }>;
    };
    expect(builtin, 'fixture lib/zlib.js = the running Node builtin source').toBe(true);
    const groups: Record<string, number> = {};
    const diffs: string[] = [];
    for (const [name, r] of Object.entries(results)) {
      groups[r.group] = (groups[r.group] ?? 0) + 1;
      if (JSON.stringify(r.node) !== JSON.stringify(r['port/N']))
        diffs.push(`${name}: ${JSON.stringify(r.node)} → ${JSON.stringify(r['port/N'])}`);
    }
    expect(groups).toEqual({ state: 45, load: 1 });
    expect(diffs).toEqual([]);
  });
});
