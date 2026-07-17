const LEGACY_WORKSPACE_KEY = 'rifty.workspaceId';

interface SessionStorageReader {
  getItem(key: string): string | null;
}

/** Captures the one historically selected workspace; never scans or mints an id. */
export function capturePlaygroundLegacyWorkspacePrefix(
  storage: SessionStorageReader,
): string | undefined {
  let selected: string | null;
  try {
    selected = storage.getItem(LEGACY_WORKSPACE_KEY);
  } catch {
    return undefined;
  }
  if (selected === null || selected.length === 0) return undefined;

  let slug = '';
  for (let index = 0; index < selected.length; index += 1) {
    const codeUnit = selected[index] as string;
    slug += /[A-Za-z0-9._-]/.test(codeUnit) ? codeUnit : '_';
  }
  return `/workspaces/${slug}`;
}
