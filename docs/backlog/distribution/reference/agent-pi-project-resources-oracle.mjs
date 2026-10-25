import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const base = await mkdtemp(join(tmpdir(), 'rifty-resource-decision-'));
const cwd = join(base, 'project');
const agentDir = join(base, 'home', '.pi', 'agent');
const ac = join(
  process.cwd(),
  'node_modules/.pnpm/@earendil-works+pi-agent-core@0.85.1_ws@8.18.3/node_modules/@earendil-works/pi-agent-core/dist',
);
const ca = join(
  process.cwd(),
  'node_modules/.pnpm/@earendil-works+pi-coding-agent@0.85.1_ws@8.18.3/node_modules/@earendil-works/pi-coding-agent/dist',
);
const { DefaultResourceLoader } = await import(`${ca}/core/resource-loader.js`);
const { SettingsManager } = await import(`${ca}/core/settings-manager.js`);
const { loadSkills } = await import(`${ac}/harness/skills.js`);
const { NodeExecutionEnv } = await import(`${ac}/harness/env/nodejs.js`);
const { BACKGROUND_CONTEXT } = await import(`${ac}/harness/context.js`);
const { formatSkillsForSystemPrompt } = await import(`${ac}/harness/system-prompt.js`);
const { formatSkillsForPrompt } = await import(`${ca}/core/skills.js`);
async function put(rel, name, opts = {}) {
  const path = join(base, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${opts.bom ? '\ufeff' : ''}---\nname: ${name}\ndescription: ${name} description\n${opts.hidden ? 'disable-model-invocation: true\n' : ''}---\nInstructions\n`,
  );
}
await mkdir(agentDir, { recursive: true });
await mkdir(join(cwd, '.git'), { recursive: true });
for (const [rel, name, opts] of [
  ['project/.pi/skills/root.md', 'pi-root'],
  ['project/.pi/skills/nested/plain.md', 'pi-nested-plain'],
  ['project/.pi/skills/nested/deep/SKILL.md', 'pi-nested-skill'],
  ['project/.agents/skills/root.md', 'agents-root'],
  ['project/.agents/skills/nested/plain.md', 'agents-nested-plain'],
  ['project/.agents/skills/nested/deep/SKILL.md', 'agents-nested-skill'],
  ['project/.pi/skills/declared/SKILL.md', 'declared'],
  ['project/.pi/skills/declared/deeper/SKILL.md', 'masked'],
  ['project/.pi/skills/.hidden/SKILL.md', 'dot-hidden'],
  ['project/.pi/skills/node_modules/SKILL.md', 'node-modules'],
  ['project/.pi/skills/hidden/SKILL.md', 'hidden', { hidden: true }],
  ['project/.pi/skills/bom/SKILL.md', 'bom', { bom: true }],
  ['project/.pi/skills/z/SKILL.md', 'collision'],
  ['project/.agents/skills/z/SKILL.md', 'collision'],
  ['home/.pi/agent/skills/z/SKILL.md', 'collision'],
  ['project/.pi/skills/Q/SKILL.md', 'letter-collision'],
  ['project/.pi/skills/c/SKILL.md', 'letter-collision'],
  ['project/.pi/skills/ignore/SKILL.md', 'ignored'],
])
  await put(rel, name, opts);
await writeFile(join(cwd, '.pi/skills/.gitignore'), 'ignore/\n');
await symlink(join(cwd, '.pi/skills/declared'), join(cwd, '.pi/skills/linked'));
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager: SettingsManager.inMemory(
    { skills: ['!**/.agents/**'] },
    { projectTrusted: true },
  ),
  noExtensions: true,
  noPromptTemplates: true,
  noThemes: true,
});
await loader.reload();
const cli = loader.getSkills();
const env = new NodeExecutionEnv({ cwd });
const core = await loadSkills(
  env,
  [join(cwd, '.pi/skills'), join(cwd, '.agents/skills')],
  BACKGROUND_CONTEXT,
);
const summary = (r) => ({
  skills: r.skills
    .filter((s) => s.filePath.startsWith(base))
    .map((s) => [s.name, s.filePath.replace(base, '<fixture>')]),
  diagnostics: r.diagnostics
    .filter((d) => d.path.startsWith(base))
    .map((d) => [d.type, d.message, d.path.replace(base, '<fixture>')]),
});
console.log(`VERSIONS core=0.85.1 cli=0.85.1 node=${process.version}`);
console.log(`FIXTURE ${base}`);
console.log(`CLI ${JSON.stringify(summary(cli), null, 2)}`);
console.log(`CORE ${JSON.stringify(summary(core), null, 2)}`);
const normalizedCore = `\n\n${formatSkillsForSystemPrompt(cli.skills).replace('Read the full skill file when the task matches its description.', "Use the read_file tool to load a skill's file when the task matches its description.")}`;
console.log(
  `FORMAT equality after approved tool-line substitution: ${normalizedCore === formatSkillsForPrompt(cli.skills).replace('Use the read tool', 'Use the read_file tool')}`,
);
