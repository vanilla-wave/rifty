import type { AgentResourceReport } from '@riftydev/agent';
import { describe, expect, it } from 'vitest';
import { unsupportedChatCommand } from './chat-command.ts';

const report = (partial: Partial<AgentResourceReport>): AgentResourceReport => ({
  fileAccess: 'available',
  contextFiles: [],
  skills: [],
  diagnostics: [],
  unsupported: [],
  ...partial,
});
const deploy = { name: 'deploy', description: 'Deploy', filePath: '/p/.pi/skills/deploy/SKILL.md' };
const prompts = { kind: 'prompts', path: '/p/.pi/prompts' };

describe('unsupportedChatCommand', () => {
  it('refuses /skill:<name> only for a loaded skill, as pi expands only those', () => {
    expect(unsupportedChatCommand('/skill:deploy', report({ skills: [deploy] }))).toBe(
      '/skill:deploy',
    );
    expect(unsupportedChatCommand('/skill:deploy now', report({ skills: [deploy] }))).toBe(
      '/skill:deploy',
    );
    expect(unsupportedChatCommand('/skill:other', report({ skills: [deploy] }))).toBeUndefined();
    expect(unsupportedChatCommand('/skill:deploy', report({}))).toBeUndefined();
    expect(unsupportedChatCommand('/skill:deploy', undefined)).toBeUndefined();
  });

  it('refuses a bare /name only when the project carries .pi/prompts templates', () => {
    expect(unsupportedChatCommand('/review', report({ unsupported: [prompts] }))).toBe('/review');
    expect(unsupportedChatCommand('/review the diff', report({ unsupported: [prompts] }))).toBe(
      '/review',
    );
    expect(unsupportedChatCommand('/review', report({}))).toBeUndefined();
    expect(
      unsupportedChatCommand(
        '/review',
        report({ unsupported: [{ kind: 'extensions', path: 'x' }] }),
      ),
    ).toBeUndefined();
  });

  it('forwards paths, comments, bare slash and /reload unchanged', () => {
    const full = report({ skills: [deploy], unsupported: [prompts] });
    for (const text of ['/src/main.tsx needs a fix', '// TODO: keep', '/', '/reload', 'plain'])
      expect(unsupportedChatCommand(text, full)).toBeUndefined();
  });
});
