// Ported from pi-coding-agent 1.6.0 src/core/skills.ts `formatSkillsForPrompt`
// (MIT, see ../../THIRD_PARTY_NOTICES.md); kill condition: ADR-0569.
export interface PromptSkill {
  readonly name: string;
  readonly description: string;
  readonly filePath: string;
  readonly disableModelInvocation?: boolean;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** CLI text for `fileReadTool: "read"`; the caller names its own read tool. */
export function formatSkillsForPrompt(skills: readonly PromptSkill[]): string {
  const visibleSkills = skills.filter((s) => !s.disableModelInvocation);
  if (visibleSkills.length === 0) return '';
  const lines = [
    '\n\nThe following skills provide specialized instructions for specific tasks.',
    "Use the read tool to load a skill's file when the task matches its description.",
    "Resolve relative paths against the skill's directory (parent of SKILL.md). Use absolute paths in tool calls.",
    '',
    '<available_skills>',
  ];
  for (const skill of visibleSkills) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}
