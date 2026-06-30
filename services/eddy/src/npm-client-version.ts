/**
 * The `@riftydev/npm-client` version eddy resolved with — reported on every
 * bundle for version-skew audit (ADR-0182 Consequences). Read from the
 * resolved package's own `package.json`; `'unknown'` (never a fabricated
 * value) if it cannot be located.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Build-time inject (tsup `define`); absent in dev/test (non-bundled), where the
// runtime resolve below finds the real on-disk package.
declare const __EDDY_NPM_CLIENT_VERSION__: string | undefined;

let cached: string | undefined;

export function readNpmClientVersion(): string {
  if (cached !== undefined) return cached;
  cached = locate();
  return cached;
}

function locate(): string {
  // Self-contained bundle: npm-client is inlined, not resolvable on disk, so the
  // version is injected at build time instead.
  if (typeof __EDDY_NPM_CLIENT_VERSION__ !== 'undefined') return __EDDY_NPM_CLIENT_VERSION__;
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
