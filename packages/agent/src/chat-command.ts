import type { AgentResourceReport } from './types.ts';

/**
 * Pi 0.85.1 `agent-session` expands `/skill:<name>` (name cut at the first space) only for a
 * loaded skill, then `/<name>` only for a `.pi/prompts/<name>.md` template; every other
 * `/`-text is a plain message. Returns the command pi would expand and the session cannot,
 * else `undefined` (forward unchanged).
 */
export function unsupportedChatCommand(
  text: string,
  report: AgentResourceReport | undefined,
): string | undefined {
  if (!report || !text.startsWith('/')) return undefined;
  if (text.startsWith('/skill:')) {
    const space = text.indexOf(' ');
    const name = space === -1 ? text.slice(7) : text.slice(7, space);
    if (report.skills.some((skill) => skill.name === name)) return `/skill:${name}`;
  }
  const name = /^\/([^\s]+)(?:\s+[\s\S]*)?$/u.exec(text)?.[1];
  if (
    name !== undefined &&
    report.unsupported.some(
      (entry) => entry.kind === 'prompts' && entry.path.endsWith(`/prompts/${name}.md`),
    )
  )
    return `/${name}`;
  return undefined;
}
