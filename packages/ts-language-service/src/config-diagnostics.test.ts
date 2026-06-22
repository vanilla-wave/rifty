/**
 * Config-file diagnostics parity (ADR-0166 / Fidelity gold standard).
 *
 * A broken/invalid `tsconfig.json` produces config-level diagnostics real
 * tsserver surfaces (e.g. an unknown `target` value). The engine routes these
 * via `getConfigFileDiagnostics()`. This test computes the EXPECTED config
 * errors from tsc's own `parseJsonConfigFileContent` (no rifty code) and
 * asserts the service surfaces the same code/message — parity, not a hardcode.
 */

import { createMemoryFs } from '@riftydev/vfs/internal';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createTsLanguageService } from './service.ts';

function writeFile(
  fsSync: ReturnType<typeof createMemoryFs>['fsSync'],
  path: string,
  text: string,
) {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  fsSync.mkdirSync(dir, { recursive: true });
  fsSync.writeFileSync(path, new TextEncoder().encode(text));
}

describe('getConfigFileDiagnostics → invalid tsconfig option', () => {
  it('surfaces an unknown compilerOption value, matching real tsc', async () => {
    const { fsSync } = createMemoryFs();
    const tsconfig = JSON.stringify({ compilerOptions: { target: 'not-a-real-target' } });
    writeFile(fsSync, '/proj/tsconfig.json', tsconfig);
    writeFile(fsSync, '/proj/a.ts', 'export const x = 1;\n');

    // Gold: tsc parses the SAME config text with its own host. No rifty code.
    // The host reports the SAME input file the VFS holds (/proj/a.ts) so neither
    // side spuriously emits TS18003 ("No inputs were found") — the only diagnostic
    // under test is the bad `target` value.
    const gold = ts.parseJsonConfigFileContent(
      JSON.parse(tsconfig),
      {
        useCaseSensitiveFileNames: true,
        fileExists: (p) => p === '/proj/a.ts',
        readFile: () => undefined,
        readDirectory: () => ['/proj/a.ts'],
      },
      '/proj',
    );
    const goldCodes = gold.errors.map((d) => d.code).sort((a, b) => a - b);
    expect(goldCodes.length).toBeGreaterThanOrEqual(1);

    const svc = await createTsLanguageService({ fsSync, projectRoot: '/proj' });
    const diags = svc.getConfigFileDiagnostics();

    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags.map((d) => d.code).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(goldCodes);
    // The message text matches tsc's flattened message for the same diagnostic.
    const goldMessages = gold.errors.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    );
    for (const m of goldMessages) {
      expect(diags.some((d) => d.message === m)).toBe(true);
    }
    // Source tag + error severity, like every other diagnostic from this service.
    for (const d of diags) {
      expect(d.source).toBe('ts');
    }
  });

  it('returns no config diagnostics for a valid tsconfig', async () => {
    const { fsSync } = createMemoryFs();
    writeFile(fsSync, '/proj/tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
    writeFile(fsSync, '/proj/a.ts', 'export const x = 1;\n');

    const svc = await createTsLanguageService({ fsSync, projectRoot: '/proj' });
    expect(svc.getConfigFileDiagnostics()).toHaveLength(0);
  });
});
