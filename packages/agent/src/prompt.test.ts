import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getAgentPromptProfile } from './prompt-profile.ts';
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

it('exports the actual default policy paragraphs for native consumers', () => {
  const profile = getAgentPromptProfile();
  const actual = systemPrompt('/', [], {}, []);
  for (const part of [profile.intro, profile.guidance, profile.recovery, profile.verification]) {
    expect(actual.split('\n\n')).toContain(part);
  }
});
