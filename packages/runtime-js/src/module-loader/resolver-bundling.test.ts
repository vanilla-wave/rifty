import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const resolverSource = readFileSync(
  fileURLToPath(new URL('./resolver.ts', import.meta.url)),
  'utf8',
);

describe('resolver bundling guards', () => {
  it('explicitly registers runtime-js builtins before builtin detection', () => {
    expect(resolverSource).toContain('ensureRuntimeJsBuiltinsRegistered');
    expect(resolverSource.indexOf('ensureRuntimeJsBuiltinsRegistered();')).toBeLessThan(
      resolverSource.indexOf('isBuiltinSpecifier(specifier)'),
    );
  });
});
