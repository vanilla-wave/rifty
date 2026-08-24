import { NotImplementedError } from '@riftydev/io';

export type PackageBin = string | readonly string[] | Readonly<Record<string, unknown>>;

export type NormalizedPackageBin = Readonly<Record<string, string>>;

/** ADR-0364: browser-safe finite copy of npm 11's active package-bin normalizer. */
export function normalizePackageBin(
  name: string | undefined,
  bin: unknown,
): NormalizedPackageBin | undefined {
  if (!bin) return undefined;

  let normalized: Record<string, unknown>;
  if (typeof bin === 'string') {
    if (!name) return undefined;
    normalized = { [name]: bin };
  } else if (Array.isArray(bin)) {
    const entries: readonly unknown[] = bin;
    normalized = entries.slice().reduce<Record<string, unknown>>((commands, entry) => {
      if (typeof entry !== 'string') {
        throw new NotImplementedError('npm-client.package-bin.non-string-array-entry');
      }
      commands[posixBasename(entry)] = entry;
      return commands;
    }, {});
  } else if (typeof bin === 'object') {
    normalized = { ...(bin as Readonly<Record<string, unknown>>) };
  } else {
    return undefined;
  }

  for (const command in normalized) {
    const target = normalized[command];
    if (typeof target !== 'string') {
      delete normalized[command];
      continue;
    }

    const canonicalCommand = posixBasename(secureAndUnixifyPath(command));
    if (!canonicalCommand) {
      delete normalized[command];
      continue;
    }

    const canonicalTarget = secureAndUnixifyPath(target);
    if (!canonicalTarget) {
      delete normalized[command];
      continue;
    }

    if (canonicalCommand !== command) delete normalized[command];
    normalized[canonicalCommand] = canonicalTarget;
  }

  return Object.keys(normalized).length === 0 ? undefined : (normalized as NormalizedPackageBin);
}

function posixBasename(path: string): string {
  let end = path.length - 1;
  while (end >= 0 && path.charCodeAt(end) === 47) end -= 1;
  if (end < 0) return '';

  const start = path.lastIndexOf('/', end);
  return path.slice(start + 1, end + 1);
}

function secureAndUnixifyPath(path: string): string {
  const unixPath = path.replace(/\\|:/g, '/');
  const segments: string[] = [];

  for (const segment of unixPath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) return '';
  const normalized = segments.join('/');
  return unixPath.endsWith('/') ? `${normalized}/` : normalized;
}
