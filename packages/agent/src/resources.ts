import { mergeSkills, projectSkills } from './project-skills.ts';
import { promptTemplatePaths } from './prompt-templates.ts';
import { resourceEntries, resourcePath, resourceWarning } from './resource-files.ts';
import type {
  AgentCapabilities,
  AgentContextFile,
  AgentResourceDiagnostic,
  AgentResourceReport,
  AgentSessionCommonOptions,
} from './types.ts';

const unsupportedKinds = [
  'extensions',
  'prompts',
  'SYSTEM.md',
  'APPEND_SYSTEM.md',
  'settings.json',
  'npm',
] as const;

export async function loadResources(
  root: string,
  capabilities: AgentCapabilities,
  options: AgentSessionCommonOptions,
): Promise<AgentResourceReport> {
  const files = capabilities.files;
  const diagnostics: AgentResourceDiagnostic[] = [];
  const contextFiles: AgentContextFile[] =
    options.contextFiles === false ? [] : structuredClone([...(options.userContextFiles ?? [])]);
  const unsupported: { kind: string; path: string }[] = [];
  if (!files) {
    diagnostics.push({
      type: 'warning',
      path: root,
      message: 'Project resources were not read: host file access is unavailable.',
    });
    return { fileAccess: 'unavailable', contextFiles, skills: [], diagnostics, unsupported };
  }
  const entries = await resourceEntries(files, root, diagnostics);
  if (options.contextFiles !== false) {
    for (const name of ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']) {
      const path = resourcePath(root, name);
      if (!entries.some((entry) => entry.path === path && entry.kind === 'file')) continue;
      try {
        const content = (await files.read(path)).replace(/^\uFEFF/, '');
        if (!contextFiles.some((file) => file.path === path)) contextFiles.push({ path, content });
        break;
      } catch (error) {
        resourceWarning(diagnostics, path, error);
      }
    }
  }
  const piDir = resourcePath(root, '.pi');
  if (entries.some((entry) => entry.path === piDir && entry.kind === 'dir')) {
    const piEntries = await resourceEntries(files, piDir, diagnostics);
    for (const kind of unsupportedKinds) {
      const path = resourcePath(piDir, kind);
      if (piEntries.some((entry) => entry.path === path)) unsupported.push({ kind, path });
    }
    const prompts = resourcePath(piDir, 'prompts');
    if (unsupported.some((entry) => entry.path === prompts)) {
      // Names a chat must refuse: pi would expand `/<name>` for each template.
      for (const path of await promptTemplatePaths(files, prompts, diagnostics))
        unsupported.push({ kind: 'prompts', path });
    }
  }
  const skills =
    options.skills === false
      ? []
      : mergeSkills(
          await projectSkills(files, root, diagnostics, entries),
          options.userSkills ?? [],
          diagnostics,
        );
  return { fileAccess: 'available', contextFiles, skills, diagnostics, unsupported };
}
