import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, expect } from '@playwright/test';
import closure from '../../tools/shadow-registry/src/fixtures/sass-1.100.0-closure.json' with {
  type: 'json',
};

/** Keep the HTTP input identical to the frozen Node oracle; install real npm bytes. */
export async function serveSassClosure(context: BrowserContext): Promise<void> {
  for (const fixture of closure.packages) {
    const path = fileURLToPath(
      new URL(
        `../../tools/shadow-registry/src/fixtures/${fixture.name}-${fixture.version}.tgz`,
        import.meta.url,
      ),
    );
    const bytes = readFileSync(path);
    expect(bytes.length).toBe(fixture.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.sha256);
    expect(`sha512-${createHash('sha512').update(bytes).digest('base64')}`).toBe(fixture.integrity);
    const manifest = JSON.parse(
      execFileSync('tar', ['-xzOf', path, 'package/package.json'], { encoding: 'utf8' }),
    ) as Record<string, unknown>;
    expect(manifest.name).toBe(fixture.name);
    expect(manifest.version).toBe(fixture.version);
    expect(manifest.dependencies ?? {}).toEqual(fixture.dependencies);
    const metadataPath = `/npm-registry/${fixture.name}`;
    const tarballPath = `/npm-registry${new URL(fixture.tarball).pathname}`;
    await context.route(
      (url) => url.pathname === metadataPath,
      (route) =>
        route.fulfill({
          json: {
            name: fixture.name,
            'dist-tags': { latest: fixture.version },
            versions: {
              [fixture.version]: {
                ...manifest,
                dist: { tarball: fixture.tarball, integrity: fixture.integrity },
              },
            },
          },
        }),
    );
    await context.route(
      (url) => url.pathname === tarballPath,
      (route) => route.fulfill({ body: bytes, contentType: 'application/octet-stream' }),
    );
  }
}
