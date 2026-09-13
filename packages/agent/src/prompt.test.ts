import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { systemPrompt } from './prompt.ts';

it('preserves the delivered default policy while exposing it to other host consumers', () => {
  const actual = systemPrompt('/', [], {}, ['Project instructions']).replace(
    /Current date: \d{4}-\d{2}-\d{2}/,
    'Current date: <DATE>',
  );
  expect(actual).toBe(
    readFileSync(new URL('./fixtures/default-prompt.txt', import.meta.url), 'utf8'),
  );
});
