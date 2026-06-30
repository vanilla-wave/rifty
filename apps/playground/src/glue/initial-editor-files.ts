import { normalizePath } from '@riftydev/vfs';

export interface InitialEditorFilesPreset {
  readonly openFiles?: readonly string[];
}

export function workspacePresetPath(root: string, path: string): string {
  const normalized = normalizePath(`${root}/${path.replace(/^\/+/, '')}`);
  if (normalized === root || !normalized.startsWith(`${root}/`)) {
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
