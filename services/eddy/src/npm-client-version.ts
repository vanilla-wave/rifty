/**
 * The `@riftydev/npm-client` version eddy resolved with — reported on every
 * bundle for version-skew audit (ADR-0182 Consequences). Read from the
 * resolved package's own `package.json`; `'unknown'` (never a fabricated
 * value) if it cannot be located.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

let cached: string | undefined;

export function readNpmClientVersion(): string {
  if (cached !== undefined) return cached;
  cached = locate();
  return cached;
}

function locate(): string {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve('@riftydev/npm-client'));
    for (let i = 0; i < 8; i++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === '@riftydev/npm-client' && pkg.version) return pkg.version;
      } catch {
        // not this directory — keep walking up
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // resolution failed — fall through to 'unknown'
  }
  return 'unknown';
}
