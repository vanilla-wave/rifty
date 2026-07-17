import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Playground App Workbench boundary', () => {
  for (const name of readdirSync(new URL('.', import.meta.url)).filter(
    (candidate) =>
      /\.tsx?$/.test(candidate) &&
      !candidate.endsWith('.test.ts') &&
      !candidate.endsWith('.test.tsx'),
  )) {
    it(`${name} imports only sealed Workbench entrypoints`, () => {
      const source = readFileSync(new URL(name, import.meta.url), 'utf8');
      const imports = source.matchAll(/from ['"]\.\.\/workbench\/([^'"]+)['"]/g);
      for (const match of imports) {
        expect(['playground.ts', 'public.ts']).toContain(match[1]);
      }
    });
  }
});
