import ignore, { type Ignore } from 'ignore';
import { parse } from 'yaml';
import { resourceEntries, resourcePath, resourceWarning } from './resource-files.ts';
import type { AgentFiles, AgentResourceDiagnostic, AgentSkill } from './types.ts';

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Pi 0.85.1 package-manager discovery; core loadSkills differs (ADR-0440). */
export async function projectSkills(
  files: AgentFiles,
  root: string,
  diagnostics: AgentResourceDiagnostic[],
  rootEntries: Awaited<ReturnType<AgentFiles['list']>>,
): Promise<AgentSkill[]> {
  const paths: string[] = [];
  async function collect(dir: string, mode: 'pi' | 'agents', base: string, matcher: Ignore) {
    const entries = await resourceEntries(files, dir, diagnostics);
    const prefix = dir === base ? '' : `${dir.slice(base.length + 1)}/`;
    for (const name of ['.gitignore', '.ignore', '.fdignore']) {
      const path = resourcePath(dir, name);
      if (!entries.some((entry) => entry.path === path && entry.kind === 'file')) continue;
      try {
        const patterns = (await files.read(path)).split(/\r?\n/).flatMap((line) => {
          if (!line.trim() || line.trim().startsWith('#')) return [];
          let pattern = line;
          const negated = pattern.startsWith('!');
          if (negated || pattern.startsWith('\\!')) pattern = pattern.slice(1);
          if (pattern.startsWith('/')) pattern = pattern.slice(1);
          return [`${negated ? '!' : ''}${prefix}${pattern}`];
        });
        matcher.add(patterns);
      } catch (error) {
        resourceWarning(diagnostics, path, error);
      }
    }
    const skill = entries.find(
      (entry) =>
        basename(entry.path) === 'SKILL.md' &&
        entry.kind === 'file' &&
        !matcher.ignores(entry.path.slice(base.length + 1)),
    );
    if (skill) {
      paths.push(skill.path);
      return;
    }
    for (const entry of entries) {
      const name = basename(entry.path);
      if (name.startsWith('.') || name === 'node_modules') continue;
      const relative = entry.path.slice(base.length + 1);
      if (matcher.ignores(`${relative}${entry.kind === 'dir' ? '/' : ''}`)) continue;
      if (entry.kind === 'dir') await collect(entry.path, mode, base, matcher);
      else if (name.endsWith('.md') && (mode === 'pi' ? dir === base : dir !== base))
        paths.push(entry.path);
    }
  }
  for (const mode of ['pi', 'agents'] as const) {
    const container = resourcePath(root, `.${mode}`);
    if (!rootEntries.some((entry) => entry.path === container && entry.kind === 'dir')) continue;
    const entries = await resourceEntries(files, container, diagnostics);
    const base = resourcePath(container, 'skills');
    if (entries.some((entry) => entry.path === base && entry.kind === 'dir'))
      await collect(base, mode, base, ignore());
  }
  const skills: AgentSkill[] = [];
  for (const path of paths) {
    let raw: string;
    try {
      raw = await files.read(path);
    } catch (error) {
      resourceWarning(diagnostics, path, error);
      continue;
    }
    let metadata: Record<string, unknown> = {};
    try {
      const normalized = raw
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      const end = normalized.startsWith('---') ? normalized.indexOf('\n---', 3) : -1;
      if (end !== -1) {
        const value: unknown = parse(normalized.slice(4, end));
        if (value !== null && typeof value === 'object')
          metadata = value as Record<string, unknown>;
      }
    } catch (error) {
      if (basename(path) === 'SKILL.md') resourceWarning(diagnostics, path, error);
      continue;
    }
    const description = metadata.description;
    if (basename(path) !== 'SKILL.md' && (typeof description !== 'string' || !description.trim()))
      continue;
    const name =
      typeof metadata.name === 'string' && metadata.name
        ? metadata.name
        : basename(path.slice(0, path.lastIndexOf('/')));
    if (validateSkill(name, description, path, diagnostics))
      skills.push({
        name,
        description: description as string,
        filePath: path,
        disableModelInvocation: metadata['disable-model-invocation'] === true,
      });
  }
  return skills;
}

function validateSkill(
  name: string,
  description: unknown,
  path: string,
  diagnostics: AgentResourceDiagnostic[],
): boolean {
  const warn = (message: string) => diagnostics.push({ type: 'warning', path, message });
  const hasDescription = typeof description === 'string' && description.trim() !== '';
  if (!hasDescription) warn('description is required');
  else if (description.length > 1024)
    warn(`description exceeds 1024 characters (${description.length})`);
  if (name.length > 64) warn(`name exceeds 64 characters (${name.length})`);
  if (!/^[a-z0-9-]+$/.test(name))
    warn('name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)');
  if (name.startsWith('-') || name.endsWith('-')) warn('name must not start or end with a hyphen');
  if (name.includes('--')) warn('name must not contain consecutive hyphens');
  return hasDescription;
}

export function mergeSkills(
  project: readonly AgentSkill[],
  supplied: readonly AgentSkill[],
  diagnostics: AgentResourceDiagnostic[],
): AgentSkill[] {
  const selected = new Map<string, AgentSkill>();
  const paths = new Set<string>();
  for (const skill of [...project, ...supplied]) {
    if (paths.has(skill.filePath)) continue;
    const winner = selected.get(skill.name);
    if (winner)
      diagnostics.push({
        type: 'collision',
        path: skill.filePath,
        message: `name "${skill.name}" collision`,
        collision: {
          resourceType: 'skill',
          name: skill.name,
          winnerPath: winner.filePath,
          loserPath: skill.filePath,
        },
      });
    else {
      selected.set(skill.name, { ...skill });
      paths.add(skill.filePath);
    }
  }
  return [...selected.values()];
}
