import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Guard only: actual packed journeys and benchmark smoke close I8 acceptance.
it('keeps benchmark composition and quality-shaping code in their existing owners', () => {
  const bench = readFileSync(new URL('./no-coi-page.ts', import.meta.url), 'utf8');
  const host = readFileSync(
    new URL(
      '../../../tests/integration/fixtures/workbench-vite-consumer/src/host.ts',
      import.meta.url,
    ),
    'utf8',
  );
  expect(bench).toContain('openReferenceHost');
  expect(bench).not.toMatch(
    /\bcreate(?:Sandbox|AgentSession|Models|OpenAIProvider|SandboxAgentHost)\s*\(/u,
  );
  expect(host).not.toMatch(
    /\b(?:streamFn|systemPrompt|applyState|isBusy|setInterval|setTimeout)\b/u,
  );
  expect(host).not.toMatch(/instructions\s*:|allowedCommands\.includes/u);
});
