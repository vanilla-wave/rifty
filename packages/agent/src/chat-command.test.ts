import { describe, expect, it } from 'vitest';
import { unsupportedChatCommand } from './chat-command.ts';
import type { AgentResourceReport } from './types.ts';

const report = (partial: Partial<AgentResourceReport>): AgentResourceReport => ({
  fileAccess: 'available',
  contextFiles: [],
  skills: [],
  diagnostics: [],
  unsupported: [],
  ...partial,
});
const deploy = { name: 'deploy', description: 'Deploy', filePath: '/p/.pi/skills/deploy/SKILL.md' };
const prompts = [
  { kind: 'prompts', path: '/p/.pi/prompts' },
  { kind: 'prompts', path: '/p/.pi/prompts/review.md' },
];

describe('unsupportedChatCommand', () => {
  it('refuses /skill:<name> only for a loaded skill, as pi expands only those', () => {
    expect(unsupportedChatCommand('/skill:deploy', report({ skills: [deploy] }))).toBe(
      '/skill:deploy',
    );
    expect(unsupportedChatCommand('/skill:deploy now', report({ skills: [deploy] }))).toBe(
      '/skill:deploy',
    );
    // Pi cuts the skill name at the first space only.
    expect(
      unsupportedChatCommand('/skill:deploy\nnow', report({ skills: [deploy] })),
    ).toBeUndefined();
    expect(unsupportedChatCommand('/skill:other', report({ skills: [deploy] }))).toBeUndefined();
    expect(unsupportedChatCommand('/skill:deploy', report({}))).toBeUndefined();
    expect(unsupportedChatCommand('/skill:deploy', undefined)).toBeUndefined();
  });

  it('refuses /name only for a reported .pi/prompts/<name>.md template', () => {
    expect(unsupportedChatCommand('/review', report({ unsupported: prompts }))).toBe('/review');
    expect(unsupportedChatCommand('/review the diff', report({ unsupported: prompts }))).toBe(
      '/review',
    );
    expect(unsupportedChatCommand('/review\nthe diff', report({ unsupported: prompts }))).toBe(
      '/review',
    );
    for (const text of ['/etc is a directory', '/missing explain this path', '/review.md'])
      expect(unsupportedChatCommand(text, report({ unsupported: prompts }))).toBeUndefined();
    expect(unsupportedChatCommand('/review', report({}))).toBeUndefined();
    expect(
      unsupportedChatCommand('/review', report({ unsupported: [prompts[0] as never] })),
    ).toBeUndefined();
  });

  it('forwards paths, comments, bare slash and /reload unchanged', () => {
    const full = report({ skills: [deploy], unsupported: prompts });
    for (const text of ['/src/main.tsx needs a fix', '// TODO: keep', '/', '/reload', 'plain'])
      expect(unsupportedChatCommand(text, full)).toBeUndefined();
  });
});
