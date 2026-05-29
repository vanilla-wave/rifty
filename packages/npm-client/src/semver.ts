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

/**
 * Coerce a possibly-partial version string (`'4'`, `'4.1'`, `'4.1.2'`) into
 * `SemverParts`. Missing minor/patch components are filled with `0` — that
 * matches npm semver's behaviour for comparator bases (`^4`, `~4.1`,
 * `>=14`). Use this when parsing the right-hand-side of a range comparator;
 * use {@link parse} when the input must be a fully-qualified released
 * version (no zero-filling).
 */
function coerce(base: string): SemverParts | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    base.trim(),
  );
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: m[2] !== undefined ? Number(m[2]) : 0,
    patch: m[3] !== undefined ? Number(m[3]) : 0,
    pre: m[4] ?? '',
  };
}

/**
 * Number of dotted numeric components in a comparator base, ignoring any
 * leading `v`/`=` and trailing pre-release/build metadata. `'^0.0'` returns
 * 2; `'^0.0.3'` returns 3 — the count drives the upper-bound choice for
 * `^` / `~` and the partial-vs-exact decision for bare comparators.
 */
function partsCount(s: string): number {
  const noPrefix = s.replace(/^[v=]/, '');
  const beforePre = noPrefix.split('-')[0] ?? noPrefix;
  return beforePre.split('.').length;
}

function fullVersion(p: SemverParts): string {
  return `${p.major}.${p.minor}.${p.patch}${p.pre ? `-${p.pre}` : ''}`;
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
  // npm allows whitespace between a comparator operator and its version base
  // (`>= 2.1.2 < 3` is equivalent to `>=2.1.2 <3`). Without normalisation the
  // tokenizer would emit four tokens (`>=`, `2.1.2`, `<`, `3`) and matching
  // each one independently produces garbage. Strip the operator-trailing
  // whitespace before splitting so both spellings collapse to the same form.
  const normalized = branch.replace(/([<>=^~])\s+/g, '$1');
  const comparators = normalized.split(/\s+/).filter(Boolean);
  for (const cmp of comparators) {
    if (!matchComparator(version, cmp)) return false;
  }
  // npm prerelease-exclusion rule (node-semver): a version with a prerelease
  // tag only satisfies this branch if some comparator targets the SAME
  // [major,minor,patch] AND carries a prerelease. Otherwise `^4` would greedily
  // accept `5.0.0-beta.3` (it sorts below the `<5.0.0` bound), mis-resolving
  // `express: ^4` to an express 5 beta.
  const v = parse(version);
  if (v && v.pre !== '') {
    const allowed = comparators.some((cmp) => {
      const cp = coerce(comparatorBase(cmp));
      return (
        cp !== null &&
        cp.pre !== '' &&
        cp.major === v.major &&
        cp.minor === v.minor &&
        cp.patch === v.patch
      );
    });
    if (!allowed) return false;
  }
  return true;
}

/** Strip a leading comparator operator (`^ ~ >= <= > < =`) to get the base. */
function comparatorBase(cmp: string): string {
  return cmp.replace(/^(>=|<=|>|<|=|\^|~)/, '');
}

function matchComparator(version: string, cmp: string): boolean {
  if (cmp.startsWith('^')) return matchCaret(version, cmp.slice(1));
  if (cmp.startsWith('~')) return matchTilde(version, cmp.slice(1));
  if (cmp.startsWith('>=')) return compareToBase(version, cmp.slice(2)) >= 0;
  if (cmp.startsWith('<=')) return compareToBase(version, cmp.slice(2)) <= 0;
  if (cmp.startsWith('>')) return compareToBase(version, cmp.slice(1)) > 0;
  if (cmp.startsWith('<')) return compareToBase(version, cmp.slice(1)) < 0;
  if (cmp.startsWith('=')) return compareToBase(version, cmp.slice(1)) === 0;
  if (cmp.includes('x') || cmp.includes('X') || cmp.includes('*')) return matchXRange(version, cmp);
  // Bare comparator: partial versions (`'4'`, `'4.1'`) are x-range patterns
  // per npm semver; only fully-qualified `X.Y.Z` is treated as exact.
  if (partsCount(cmp) < 3) return matchXRange(version, cmp);
  return compare(version, cmp) === 0;
}

/**
 * Compare `version` against a possibly-partial `base` (e.g. `>=4` → base
 * `'4'`). Partial bases are zero-filled via {@link coerce} — slightly more
 * permissive than real `node-semver`, which interprets `>4` as `>=5.0.0`,
 * but acceptable for installer use: the only effect is that a few packages
 * may resolve to a narrower version than strict semver would allow.
 */
function compareToBase(version: string, base: string): number {
  const p = coerce(base);
  if (!p) return version < base ? -1 : version > base ? 1 : 0;
  return compare(version, fullVersion(p));
}

function matchCaret(version: string, base: string): boolean {
  const bounds = caretBounds(base);
  const v = parse(version);
  if (!bounds || !v) return false;
  return (
    compare(version, fullVersion(bounds.min)) >= 0 &&
    compare(version, fullVersion(bounds.maxExclusive)) < 0
  );
}

function matchTilde(version: string, base: string): boolean {
  const bounds = tildeBounds(base);
  const v = parse(version);
  if (!bounds || !v) return false;
  return (
    compare(version, fullVersion(bounds.min)) >= 0 &&
    compare(version, fullVersion(bounds.maxExclusive)) < 0
  );
}

/**
 * Translate `^base` into `[min, maxExclusive)` per npm semver:
 *   - `^4`     → `>=4.0.0 <5.0.0`
 *   - `^4.21`  → `>=4.21.0 <5.0.0`
 *   - `^4.21.0`→ `>=4.21.0 <5.0.0`
 *   - `^0`     → `>=0.0.0 <1.0.0`
 *   - `^0.2`   → `>=0.2.0 <0.3.0`
 *   - `^0.0.3` → `>=0.0.3 <0.0.4`
 *   - `^0.0`   → `>=0.0.0 <0.1.0`
 */
function caretBounds(base: string): { min: SemverParts; maxExclusive: SemverParts } | null {
  const p = coerce(base);
  if (!p) return null;
  const parts = partsCount(base);
  if (p.major > 0) {
    return { min: p, maxExclusive: { major: p.major + 1, minor: 0, patch: 0, pre: '' } };
  }
  if (parts < 2) {
    return { min: p, maxExclusive: { major: 1, minor: 0, patch: 0, pre: '' } };
  }
  if (p.minor > 0) {
    return { min: p, maxExclusive: { major: 0, minor: p.minor + 1, patch: 0, pre: '' } };
  }
  if (parts < 3) {
    return { min: p, maxExclusive: { major: 0, minor: 1, patch: 0, pre: '' } };
  }
  return { min: p, maxExclusive: { major: 0, minor: 0, patch: p.patch + 1, pre: '' } };
}

/**
 * Translate `~base` into `[min, maxExclusive)` per npm semver:
 *   - `~4`     → `>=4.0.0 <5.0.0` (equivalent to `^4`)
 *   - `~4.1`   → `>=4.1.0 <4.2.0`
 *   - `~4.1.2` → `>=4.1.2 <4.2.0`
 */
function tildeBounds(base: string): { min: SemverParts; maxExclusive: SemverParts } | null {
  const p = coerce(base);
  if (!p) return null;
  if (partsCount(base) <= 1) {
    return { min: p, maxExclusive: { major: p.major + 1, minor: 0, patch: 0, pre: '' } };
  }
  return { min: p, maxExclusive: { major: p.major, minor: p.minor + 1, patch: 0, pre: '' } };
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
