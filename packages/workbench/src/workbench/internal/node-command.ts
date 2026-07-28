import { assertProjectPath } from '../project-file-boundary.ts';

function projectEntry(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value === '/' ||
    value.includes('\0')
  ) {
    throw new TypeError('Node project entryPath must be a project-rooted file path');
  }
  const segments = value.split('/');
  if (
    segments.some(
      (segment, index) => index > 0 && (segment === '' || segment === '.' || segment === '..'),
    )
  ) {
    throw new TypeError('Node project entryPath must be normalized inside the project root');
  }
  return value;
}

export function projectRuntimeShellWord(value: string): string {
  if (value.includes('\0')) throw new TypeError('Node CLI argument must not contain NUL');
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Exact `node <entry>` spelling for a command run from the project root. */
export function nodeProjectRootShellCommand(entryPath: unknown): string {
  return `node ${projectRuntimeShellWord(projectEntry(entryPath).slice(1))}`;
}

/** Relative spelling between two paths in the public project namespace. */
export function projectRelativePath(targetValue: unknown, cwdValue: unknown): string {
  if (typeof targetValue !== 'string' || typeof cwdValue !== 'string') {
    throw new TypeError('Project runtime paths must be strings');
  }
  const target = assertProjectPath(targetValue, { allowRoot: true });
  const cwd = assertProjectPath(cwdValue, { allowRoot: true });
  const targetSegments = target === '/' ? [] : target.slice(1).split('/');
  const cwdSegments = cwd === '/' ? [] : cwd.slice(1).split('/');
  let shared = 0;
  while (
    shared < targetSegments.length &&
    shared < cwdSegments.length &&
    targetSegments[shared] === cwdSegments[shared]
  ) {
    shared++;
  }
  const segments = [...cwdSegments.slice(shared).map(() => '..'), ...targetSegments.slice(shared)];
  if (segments.length === 0) return '.';
  const relative = segments.join('/');
  return relative.startsWith('..') ? relative : `./${relative}`;
}

/** Exact project-rooted entry + argv spelling shared by definitions and runtimes. */
export function nodeProjectShellCommand(
  entryPath: unknown,
  args: readonly unknown[],
  cwd: unknown = '/',
): string {
  if (!Array.isArray(args)) throw new TypeError('Node CLI args must be an array');
  const words = args.map((argument, index) => {
    if (typeof argument !== 'string') {
      throw new TypeError(`Node CLI argument ${index} must be a string`);
    }
    return projectRuntimeShellWord(argument);
  });
  return [
    'node',
    projectRuntimeShellWord(projectRelativePath(projectEntry(entryPath), cwd)),
    ...words,
  ].join(' ');
}
