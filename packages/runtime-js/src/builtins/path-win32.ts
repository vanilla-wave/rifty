/**
 * Node `path.win32`. The browser filesystem stays POSIX (`path` / `path.posix`);
 * this object is the Windows algorithm Node exposes even on a POSIX host.
 */
import { getProcessCwd } from './process.ts';

export interface Win32ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

const SEP = '\\';

function isSep(code: number): boolean {
  return code === 47 || code === 92;
}

function isDevice(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function normalizeTail(path: string, allowAboveRoot: boolean): string {
  let res = '';
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let code = 0;
  for (let i = 0; i <= path.length; i++) {
    if (i < path.length) code = path.charCodeAt(i);
    else if (isSep(code)) break;
    else code = 47;
    if (isSep(code)) {
      if (lastSlash === i - 1 || dots === 1) {
        // skip
      } else if (dots === 2) {
        const canPop =
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.charCodeAt(res.length - 1) !== 46 ||
          res.charCodeAt(res.length - 2) !== 46;
        if (canPop) {
          if (res.length > 2) {
            const cut = res.length - lastSegmentLength - 1;
            res = cut === -1 ? '' : res.slice(0, cut);
            lastSegmentLength = res.length - 1 - res.lastIndexOf(SEP);
            lastSlash = i;
            dots = 0;
            continue;
          }
          if (res.length !== 0) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? `${SEP}..` : '..';
          lastSegmentLength = 2;
        }
      } else if (res.length > 0) {
        res += `${SEP}${path.slice(lastSlash + 1, i)}`;
        lastSegmentLength = i - lastSlash - 1;
      } else {
        res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) dots += 1;
    else dots = -1;
  }
  return res;
}

interface Root {
  device: string | undefined;
  rootEnd: number;
  absolute: boolean;
}

function matchRoot(path: string): Root {
  const len = path.length;
  const code = path.charCodeAt(0);
  if (len > 0 && isSep(code)) {
    if (len > 1 && isSep(path.charCodeAt(1))) {
      let j = 2;
      const serverStart = j;
      while (j < len && !isSep(path.charCodeAt(j))) j += 1;
      if (j < len && j !== serverStart) {
        const server = path.slice(serverStart, j);
        const sepStart = j;
        while (j < len && isSep(path.charCodeAt(j))) j += 1;
        if (j < len && j !== sepStart) {
          const shareStart = j;
          while (j < len && !isSep(path.charCodeAt(j))) j += 1;
          if (j === len || j !== shareStart) {
            if (server !== '.' && server !== '?') {
              return {
                device: `\\\\${server}\\${path.slice(shareStart, j)}`,
                rootEnd: j,
                absolute: true,
              };
            }
            return { device: `\\\\${server}`, rootEnd: 4, absolute: true };
          }
        }
      }
    }
    return { device: undefined, rootEnd: 1, absolute: true };
  }
  if (len > 1 && isDevice(code) && path.charCodeAt(1) === 58) {
    const absolute = len > 2 && isSep(path.charCodeAt(2));
    return { device: path.slice(0, 2), rootEnd: absolute ? 3 : 2, absolute };
  }
  return { device: undefined, rootEnd: 0, absolute: false };
}

function resolve(...args: string[]): string {
  let resolvedDevice = '';
  let resolvedTail = '';
  let resolvedAbsolute = false;
  for (let i = args.length - 1; i >= -1; i--) {
    let path: string;
    if (i >= 0) {
      const arg = args[i];
      if (arg === undefined || arg.length === 0) continue;
      path = arg;
    } else if (resolvedDevice.length === 0) {
      path = getProcessCwd().replaceAll('/', SEP);
      if (
        args.length === 0 ||
        (args.length === 1 && (args[0] === '' || args[0] === '.') && isSep(path.charCodeAt(0)))
      ) {
        return path;
      }
    } else {
      const cwd = getProcessCwd().replaceAll('/', SEP);
      path =
        cwd.slice(0, 2).toLowerCase() === resolvedDevice.toLowerCase()
          ? cwd
          : `${resolvedDevice}\\`;
    }
    const root = matchRoot(path);
    if (root.device) {
      if (resolvedDevice.length > 0) {
        if (root.device.toLowerCase() !== resolvedDevice.toLowerCase()) continue;
      } else resolvedDevice = root.device;
    }
    if (resolvedAbsolute) {
      if (resolvedDevice.length > 0) break;
    } else {
      resolvedTail = `${path.slice(root.rootEnd)}\\${resolvedTail}`;
      resolvedAbsolute = root.absolute;
      if (root.absolute && resolvedDevice.length > 0) break;
    }
  }
  resolvedTail = normalizeTail(resolvedTail, !resolvedAbsolute);
  if (resolvedAbsolute) return `${resolvedDevice}\\${resolvedTail}`;
  return `${resolvedDevice}${resolvedTail}` || '.';
}

function normalize(path: string): string {
  if (path.length === 0) return '.';
  if (path.length === 1) return isSep(path.charCodeAt(0)) ? SEP : path;
  const root = matchRoot(path);
  let tail =
    root.rootEnd < path.length ? normalizeTail(path.slice(root.rootEnd), !root.absolute) : '';
  if (tail.length === 0 && !root.absolute) tail = '.';
  if (tail.length > 0 && isSep(path.charCodeAt(path.length - 1))) tail += SEP;
  if (root.device === undefined) return root.absolute ? `${SEP}${tail}` : tail;
  return root.absolute ? `${root.device}\\${tail}` : `${root.device}${tail}`;
}

function isAbsolute(path: string): boolean {
  if (path.length === 0) return false;
  const code = path.charCodeAt(0);
  return (
    isSep(code) ||
    (path.length > 2 && isDevice(code) && path.charCodeAt(1) === 58 && isSep(path.charCodeAt(2)))
  );
}

function join(...args: string[]): string {
  const parts = args.filter((part) => part.length > 0);
  if (parts.length === 0) return '.';
  const first = parts[0] ?? '';
  let joined = parts.join(SEP);
  let needsReplace = true;
  let slashCount = 0;
  if (isSep(first.charCodeAt(0))) {
    slashCount += 1;
    if (first.length > 1 && isSep(first.charCodeAt(1))) {
      slashCount += 1;
      if (first.length > 2) {
        if (isSep(first.charCodeAt(2))) slashCount += 1;
        else needsReplace = false;
      }
    }
  }
  if (needsReplace) {
    while (slashCount < joined.length && isSep(joined.charCodeAt(slashCount))) slashCount += 1;
    if (slashCount >= 2) joined = `${SEP}${joined.slice(slashCount)}`;
  }
  return normalize(joined);
}

function dirname(path: string): string {
  const len = path.length;
  if (len === 0) return '.';
  const code = path.charCodeAt(0);
  if (len === 1) return isSep(code) ? path : '.';
  let rootEnd = -1;
  let offset = 0;
  if (isSep(code)) {
    rootEnd = 1;
    offset = 1;
    if (isSep(path.charCodeAt(1))) {
      const root = matchRoot(path);
      if (root.device && root.rootEnd >= len) return path;
      if (root.device) {
        rootEnd = root.rootEnd + 1;
        offset = rootEnd;
      }
    }
  } else if (isDevice(code) && path.charCodeAt(1) === 58) {
    rootEnd = len > 2 && isSep(path.charCodeAt(2)) ? 3 : 2;
    offset = rootEnd;
  }
  let end = -1;
  let matchedSlash = true;
  for (let i = len - 1; i >= offset; i--) {
    if (isSep(path.charCodeAt(i))) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else matchedSlash = false;
  }
  if (end === -1) {
    if (rootEnd === -1) return '.';
    end = rootEnd;
  }
  return path.slice(0, end);
}

function basename(path: string, suffix?: string): string {
  let start = 0;
  if (path.length >= 2 && isDevice(path.charCodeAt(0)) && path.charCodeAt(1) === 58) start = 2;
  let end = -1;
  let matchedSlash = true;
  if (suffix !== undefined && suffix.length > 0 && suffix.length <= path.length) {
    if (suffix === path) return '';
    let extIdx = suffix.length - 1;
    let firstNonSlashEnd = -1;
    for (let i = path.length - 1; i >= start; i--) {
      const code = path.charCodeAt(i);
      if (isSep(code)) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          if (code === suffix.charCodeAt(extIdx)) {
            extIdx -= 1;
            if (extIdx === -1) end = i;
          } else {
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }
    if (start === end) end = firstNonSlashEnd;
    else if (end === -1) end = path.length;
    return path.slice(start, end);
  }
  for (let i = path.length - 1; i >= start; i--) {
    if (isSep(path.charCodeAt(i))) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) return '';
  return path.slice(start, end);
}

function extname(path: string): string {
  let start = 0;
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  if (path.length >= 2 && path.charCodeAt(1) === 58 && isDevice(path.charCodeAt(0))) {
    start = 2;
    startPart = 2;
  }
  for (let i = path.length - 1; i >= start; i--) {
    const code = path.charCodeAt(i);
    if (isSep(code)) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || startDot < startPart) return '';
  return path.slice(startDot, end);
}

function relative(from: string, to: string): string {
  if (from === to) return '';
  const fromOrig = resolve(from);
  const toOrig = resolve(to);
  if (fromOrig === toOrig || fromOrig.toLowerCase() === toOrig.toLowerCase()) return '';
  const fromParts = fromOrig
    .split(SEP)
    .filter((part, index, all) => part.length > 0 || (index === 0 && all.length > 1));
  const toParts = toOrig.split(SEP).filter((part) => part.length > 0);
  // Drive-letter paths split to ['C:', 'foo']. UNC splits to ['', '', 'server', ...].
  let i = 0;
  const length = Math.min(fromParts.length, toParts.length);
  for (; i < length; i++) {
    if ((fromParts[i] ?? '').toLowerCase() !== (toParts[i] ?? '').toLowerCase()) break;
  }
  if (i === 0) return toOrig;
  const ups = fromParts.length - i;
  const down = toParts.slice(i);
  const segments: string[] = [];
  for (let n = 0; n < ups; n++) segments.push('..');
  segments.push(...down);
  return segments.join(SEP);
}

function toNamespacedPath(path: string): string {
  if (path.length === 0) return path;
  const resolvedPath = resolve(path);
  if (resolvedPath.length <= 2) return path;
  if (resolvedPath.charCodeAt(0) === 92) {
    if (resolvedPath.charCodeAt(1) === 92) {
      const code = resolvedPath.charCodeAt(2);
      if (code !== 63 && code !== 46) return `\\\\?\\UNC\\${resolvedPath.slice(2)}`;
    }
  } else if (
    isDevice(resolvedPath.charCodeAt(0)) &&
    resolvedPath.charCodeAt(1) === 58 &&
    resolvedPath.charCodeAt(2) === 92
  ) {
    return `\\\\?\\${resolvedPath}`;
  }
  return resolvedPath;
}

function parse(path: string): Win32ParsedPath {
  const rootInfo = matchRoot(path);
  const absoluteRoot = rootInfo.absolute ? (rootInfo.device ? `${rootInfo.device}\\` : SEP) : '';
  const dir = dirname(path).replaceAll('/', SEP);
  const base = basename(path);
  const ext = extname(path);
  const name = ext ? base.slice(0, base.length - ext.length) : base;
  return { root: absoluteRoot, dir: dir === '.' ? '' : dir, base, ext, name };
}

function format(o: Partial<Win32ParsedPath>): string {
  const dir = o.dir ?? o.root ?? '';
  const ext = o.ext ? (o.ext.startsWith('.') ? o.ext : `.${o.ext}`) : '';
  const base = o.base ?? `${o.name ?? ''}${ext}`;
  if (!dir) return base;
  if (dir === o.root) return `${dir}${base}`;
  return dir.endsWith(SEP) ? `${dir}${base}` : `${dir}${SEP}${base}`;
}

export const win32 = {
  sep: SEP,
  delimiter: ';',
  join,
  resolve,
  normalize,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
  toNamespacedPath,
};
