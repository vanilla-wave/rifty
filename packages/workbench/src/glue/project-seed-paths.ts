import { normalizePath } from '@riftydev/vfs';

/** Path equals the container or is its segment-boundary descendant. */
export function isSegmentContained(path: string, container: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedContainer = normalizePath(container);
  return (
    normalizedPath === normalizedContainer ||
    (normalizedContainer === '/'
      ? normalizedPath.startsWith('/')
      : normalizedPath.startsWith(`${normalizedContainer}/`))
  );
}

/** Source files only; dependency-derived bytes stay under package authority. */
export function withoutProjectNodeModulesFiles(
  root: string,
  files: Readonly<Record<string, string>>,
): Record<string, string> {
  const nodeModules = normalizePath(`${root}/node_modules`);
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => !isSegmentContained(path, nodeModules)),
  );
}
