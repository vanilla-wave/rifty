/**
 * Minimal semver. Real `node-semver` is ~30 KB and covers edge cases we don't
 * need yet (prereleases with multiple identifiers, build metadata in matches).
 * We do enough for the M9 acceptance: caret, tilde, x-ranges, comparator sets,
 * union via `||`.
 */

export interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  pre: string;
}

export function parse(v: string): SemverParts | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ?? '',
  };
}

export function compare(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === '') return 1; // release > prerelease
  if (pb.pre === '') return -1;
  return comparePreRelease(pa.pre, pb.pre);
}

/**
 * Compare pre-release identifiers per semver §11.4:
 *   - identifiers are dot-separated;
 *   - numeric identifiers compare numerically;
 *   - non-numeric identifiers compare lexicographically (ASCII);
 *   - numeric identifiers always have lower precedence than non-numeric;
 *   - a larger set of identifiers has higher precedence than a smaller set
 *     when all preceding identifiers are equal.
 *
 * E.g. `1.0.0-alpha.2 < 1.0.0-alpha.10` (numeric, lexicographic would put 10 first),
 * `1.0.0-1 < 1.0.0-alpha` (numeric always < non-numeric).
 */
function comparePreRelease(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const len = Math.min(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const ai = as[i];
    const bi = bs[i];
    if (ai === undefined || bi === undefined) break;
    if (ai === bi) continue;
    const aIsNum = /^\d+$/.test(ai);
    const bIsNum = /^\d+$/.test(bi);
    if (aIsNum && bIsNum) {
      const an = Number.parseInt(ai, 10);
      const bn = Number.parseInt(bi, 10);
      if (an !== bn) return an < bn ? -1 : 1;
      continue;
    }
    if (aIsNum) return -1; // numeric < non-numeric
    if (bIsNum) return 1;
    return ai < bi ? -1 : 1;
  }
  if (as.length === bs.length) return 0;
  return as.length < bs.length ? -1 : 1;
}

/**
 * Returns true iff `version` matches the npm-style `range` string.
 * Supports:
 *   - `*` / empty / `'latest'`
 *   - exact `1.2.3`
 *   - `1.x` / `1.2.x`
 *   - `^1.2.3`, `~1.2.3`
 *   - comparator sets `>=1.0.0 <2.0.0`
 *   - union `||` (any branch matches)
 */
export function matchesRange(version: string, range: string | undefined | null): boolean {
  if (!range || range === '*' || range === 'latest' || range === '') return true;
  const branches = range
    .split('||')
    .map((b) => b.trim())
    .filter(Boolean);
  for (const branch of branches) {
    if (matchBranch(version, branch)) return true;
  }
  return false;
}

function matchBranch(version: string, branch: string): boolean {
  const comparators = branch.split(/\s+/).filter(Boolean);
  for (const cmp of comparators) {
    if (!matchComparator(version, cmp)) return false;
  }
  return true;
}

function matchComparator(version: string, cmp: string): boolean {
  if (cmp.startsWith('^')) return matchCaret(version, cmp.slice(1));
  if (cmp.startsWith('~')) return matchTilde(version, cmp.slice(1));
  if (cmp.startsWith('>=')) return compare(version, cmp.slice(2)) >= 0;
  if (cmp.startsWith('<=')) return compare(version, cmp.slice(2)) <= 0;
  if (cmp.startsWith('>')) return compare(version, cmp.slice(1)) > 0;
  if (cmp.startsWith('<')) return compare(version, cmp.slice(1)) < 0;
  if (cmp.startsWith('=')) return compare(version, cmp.slice(1)) === 0;
  if (cmp.includes('x') || cmp.includes('*')) return matchXRange(version, cmp);
  return compare(version, cmp) === 0;
}

function matchCaret(version: string, base: string): boolean {
  const p = parse(base);
  const v = parse(version);
  if (!p || !v) return false;
  if (compare(version, base) < 0) return false;
  if (p.major > 0) return v.major === p.major;
  if (p.minor > 0) return v.major === 0 && v.minor === p.minor;
  return v.major === 0 && v.minor === 0 && v.patch === p.patch;
}

function matchTilde(version: string, base: string): boolean {
  const p = parse(base);
  const v = parse(version);
  if (!p || !v) return false;
  if (compare(version, base) < 0) return false;
  return v.major === p.major && v.minor === p.minor;
}

function matchXRange(version: string, range: string): boolean {
  const parts = range.replace(/^[v=]/, '').split('.');
  const v = parse(version);
  if (!v) return false;
  const lookup = [v.major, v.minor, v.patch];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === 'x' || part === 'X' || part === '*') continue;
    if (Number(part) !== lookup[i]) return false;
  }
  return true;
}

export function pickBestVersion(
  versions: readonly string[],
  range: string | undefined | null,
): string | null {
  const candidates = versions.filter((v) => matchesRange(v, range));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => compare(b, a));
  return candidates[0] ?? null;
}
