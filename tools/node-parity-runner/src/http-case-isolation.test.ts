import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const casesDir = fileURLToPath(new URL('../cases/http/', import.meta.url));
const httpCases = readdirSync(casesDir).filter((name) => name.endsWith('.case.ts'));

describe('HTTP parity case isolation', () => {
  it.each(httpCases)('%s never binds a fixed OS port', (name) => {
    const source = readFileSync(new URL(`../cases/http/${name}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bconst PORT\s*=\s*\d+/);
  });
});
