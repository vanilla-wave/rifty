import type { AgentResourceReport } from '@riftydev/agent';

/**
 * Pi 0.85.1 `agent-session` expands `/skill:<name>` only for a loaded skill and `/<name>` only
 * for a `.pi/prompts` template; every other `/`-text is a plain message. Returns the command
 * pi would expand and the playground cannot, else `undefined` (forward unchanged).
 */
export function unsupportedChatCommand(
  text: string,
  report: AgentResourceReport | undefined,
): string | undefined {
  const command = text.split(/\s/)[0] ?? '';
  if (!command.startsWith('/') || command === '/reload') return undefined;
  if (command.startsWith('/skill:')) {
    const name = command.slice('/skill:'.length);
    return report?.skills.some((skill) => skill.name === name) ? command : undefined;
  }
  const name = command.slice(1);
  // Template names are `.md` basenames: never empty, never containing `/`. Templates are not
  // loaded (compat ❌), so any candidate name in a project carrying `.pi/prompts` is refused.
  if (!name || name.includes('/')) return undefined;
  return report?.unsupported.some((entry) => entry.kind === 'prompts') ? command : undefined;
}
