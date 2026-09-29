/**
 * npm-package-arg's registry-spec reading (`fromRegistry`): a spec is a
 * version/range when `semver.validRange(spec, true)` accepts it (every loose
 * version is also a loose range), else a dist-tag. Port of node-semver
 * 7.8.4's LOOSE recognizer (`internal/re.js`, `classes/range.js`
 * `parseRange`/`parseComparator`), recognition only — matching stays in
 * `semver.ts`. Loose mode drops invalid tokens, so a `||` branch counts when
 * any token survives (`1.2.3 foo` reads `1.2.3`). Unmodelled: components past
 * `Number.MAX_SAFE_INTEGER` / versions past 256 chars (semver throws → tag).
 * Oracle: `docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json`.
 */

const PRE_ID = String.raw`(?:\d*[a-zA-Z-][a-zA-Z0-9-]*|\d+)`;
const PRE = String.raw`(?:-?${PRE_ID}(?:\.${PRE_ID})*)`;
const STRICT_PRE_ID = String.raw`(?:\d*[a-zA-Z-][a-zA-Z0-9-]*|0|[1-9]\d*)`;
const STRICT_PRE = String.raw`(?:-${STRICT_PRE_ID}(?:\.${STRICT_PRE_ID})*)`;
const BUILD = String.raw`(?:\+[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)`;
const LOOSE_PLAIN = String.raw`[v=\s]*\d+\.\d+\.\d+${PRE}?${BUILD}?`;
const GTLT = '((?:<|>)?=?)';
const xPlain = (id: string, pre: string) =>
  String.raw`[v=\s]*(${id})(?:\.(${id})(?:\.(${id})(?:${pre})?${BUILD}?)?)?`;
const X_PLAIN = xPlain(String.raw`\d+|x|X|\*`, PRE);
const STRICT_X_PLAIN = xPlain(String.raw`0|[1-9]\d*|x|X|\*`, STRICT_PRE);

const BUILD_STRIP = new RegExp(BUILD, 'g');
const HYPHEN = new RegExp(String.raw`^\s*(${X_PLAIN})\s+-\s+(${X_PLAIN})\s*$`);
const COMPARATOR_TRIM = new RegExp(
  String.raw`(\s*)${GTLT}\s*(${LOOSE_PLAIN}|${STRICT_X_PLAIN})`,
  'g',
);
const TILDE_TRIM = /(\s*)(?:~>?)\s+/g;
const CARET_TRIM = /(\s*)\^\s+/g;
const CARET = new RegExp(String.raw`^\^${X_PLAIN}$`);
const TILDE = new RegExp(String.raw`^~>?${X_PLAIN}$`);
const X_RANGE = new RegExp(String.raw`^${GTLT}\s*${X_PLAIN}$`);
const STAR = /(<|>)?=?\s*\*/;
const COMPARATOR = new RegExp(String.raw`^${GTLT}\s*(${LOOSE_PLAIN})$|^$`);

const isX = (id: string | undefined) => !id || id.toLowerCase() === 'x' || id === '*';

/** One token's `parseComparator` output: `''` (any), valid comparators, or kept invalid text. */
function comparatorOutput(token: string): '' | 'valid' | 'invalid' {
  const caret = CARET.exec(token) ?? TILDE.exec(token);
  if (caret) return isX(caret[1]) ? '' : 'valid';
  const x = X_RANGE.exec(token);
  if (x) {
    const [, gtlt, major, minor, patch] = x;
    const badOrder = (isX(major) && !isX(minor)) || (isX(minor) && patch && !isX(patch));
    if (!badOrder) return isX(major) && gtlt !== '<' && gtlt !== '>' ? '' : 'valid';
  }
  const rest = token.replace(STAR, '');
  return rest === '' ? '' : COMPARATOR.test(rest) ? 'valid' : 'invalid';
}

function branchKeepsComparator(branch: string): boolean {
  const stripped = branch.replace(BUILD_STRIP, '');
  if (HYPHEN.test(stripped)) return true;
  const outputs = stripped
    .replace(COMPARATOR_TRIM, '$1$2$3')
    .replace(TILDE_TRIM, '$1~')
    .replace(CARET_TRIM, '$1^')
    .split(' ')
    .map((token) => (token === '' ? '' : comparatorOutput(token)));
  // semver re-joins outputs with ' ' and re-splits on /\s+/: an `''` output
  // between two tokens vanishes, one at either end survives as "any".
  return outputs
    .map((output) => (output === 'valid' ? 'v' : output === 'invalid' ? 'i' : ''))
    .join(' ')
    .split(/\s+/)
    .some((comparator) => comparator !== 'i');
}

/** True when npm reads `spec` as a version or range of the named package. */
export function isLooseSemverRange(spec: string): boolean {
  return spec
    .trim()
    .replace(/\s+/g, ' ')
    .split('||')
    .some((branch) => branchKeepsComparator(branch.trim()));
}
