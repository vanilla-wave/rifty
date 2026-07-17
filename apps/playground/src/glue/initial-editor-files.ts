import { normalizePath } from '@riftydev/vfs';

export interface InitialEditorFilesPreset {
  readonly openFiles?: readonly string[];
}

export function workspacePresetPath(root: string, path: string): string {
  const relative = path.replace(/^\/+/, '');
  let depth = 0;
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (depth === 0) throw new Error(`Preset file escapes workspace: ${path}`);
      depth -= 1;
    } else {
      depth += 1;
    }
  }

  const normalizedRoot = normalizePath(root);
  const normalized = normalizePath(`${normalizedRoot}/${relative}`);
  const prefix = normalizedRoot === '/' ? '/' : `${normalizedRoot}/`;
  if (normalized === normalizedRoot || !normalized.startsWith(prefix)) {
    throw new Error(`Preset file escapes workspace: ${path}`);
  }
  return normalized;
}

export function initialEditorFilesForPreset(
  preset: InitialEditorFilesPreset,
  root: string,
): readonly string[] {
  const paths: string[] = [];
  for (const path of preset.openFiles ?? []) {
    const abs = workspacePresetPath(root, path);
    if (!paths.includes(abs)) paths.push(abs);
  }
  return paths;
}
