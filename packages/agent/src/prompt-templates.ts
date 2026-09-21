import ignore from 'ignore';
import { parse } from 'yaml';
import { addIgnoreRules, resourceEntries } from './resource-files.ts';
import type { AgentFiles, AgentResourceDiagnostic } from './types.ts';

/**
 * Pi 0.85.1 package-manager `collectAutoPromptEntries` + `loadTemplateFromFile`: the
 * `.pi/prompts/*.md` files pi would expand as `/<name>` — non-recursive, dotfiles and
 * `node_modules` skipped, ignore rules applied, unreadable files and malformed frontmatter
 * YAML dropped without a diagnostic. Templates are not supported: paths are reported,
 * contents discarded.
 */
export async function promptTemplatePaths(
  files: AgentFiles,
  dir: string,
  diagnostics: AgentResourceDiagnostic[],
): Promise<string[]> {
  const entries = await resourceEntries(files, dir, diagnostics);
  const matcher = ignore();
  await addIgnoreRules(files, dir, '', entries, matcher);
  const paths: string[] = [];
  for (const entry of entries) {
    const name = entry.path.slice(dir.length + 1);
    if (entry.kind !== 'file' || !name.endsWith('.md')) continue;
    if (name.startsWith('.') || name === 'node_modules' || matcher.ignores(name)) continue;
    try {
      const normalized = (await files.read(entry.path))
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      const end = normalized.startsWith('---') ? normalized.indexOf('\n---', 3) : -1;
      const yaml = end === -1 ? '' : normalized.slice(4, end);
      if (yaml) parse(yaml);
    } catch {
      continue;
    }
    paths.push(entry.path);
  }
  return paths;
}
