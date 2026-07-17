import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps the App-owned ProjectSpec outside Workbench implementation files', () => {
  const source = readFileSync(new URL('./project-spec.ts', import.meta.url), 'utf8');
  expect(source).not.toContain("from '../workbench/internal/");
});
