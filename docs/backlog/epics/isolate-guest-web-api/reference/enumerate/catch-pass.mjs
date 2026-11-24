// Static pass (manager question 3, second proposal): every `try { … } catch` in the prod sources the
// isolate guest bundles whose try body names a ceiling global (web-shim.ts CEILING_GLOBALS, plus
// `crypto.subtle` and runtime-js's URL helpers). Prints file:line, the names, and the catch body.
// From the repo root: node docs/backlog/epics/isolate-guest-web-api/reference/enumerate/catch-pass.mjs [--json out.json]
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const shim = readFileSync(join(root, 'packages/isolate-guest/src/guest/web-shim.ts'), 'utf8');
const names = [
  ...shim
    .slice(shim.indexOf('CEILING_GLOBALS = ['))
    .split('] as const')[0]
    .matchAll(/'([A-Za-z]+)'/g),
].map((m) => m[1]);
// runtime-js helpers that construct a URL internally (posix-file-url.ts) count as a URL use.
names.push(
  'subtle',
  'URLConstructor',
  'fileURLToPathPosix',
  'fileURLFromResolvedPath',
  'pathToFileURL',
  'fileURLToPath',
);
const re = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) {
      if (e !== 'node_modules' && e !== 'generated') walk(p);
      continue;
    }
    if (
      /\.(ts|js|mjs|cjs)$/.test(e) &&
      !/\.(test|spec|fault\.test)\./.test(e) &&
      !e.endsWith('.d.ts')
    )
      files.push(p);
  }
};
for (const pkg of ['runtime-js', 'io', 'vfs', 'kernel', 'net'])
  walk(join(root, 'packages', pkg, 'src'));

// Brace matcher that skips strings, template literals and comments well enough for this survey.
function block(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) return src.length;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return src.length;
}
const rows = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\btry\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = block(src, open);
    const body = src.slice(open, close + 1);
    const used = [...new Set([...body.matchAll(re)].map((x) => x[1]))];
    if (!used.length) continue;
    const rest = src.slice(close + 1);
    const cm = /^\s*catch\s*(\([^)]*\))?\s*\{/.exec(rest);
    if (!cm) continue; // try/finally only
    const cOpen = close + 1 + cm[0].length - 1;
    const cClose = block(src, cOpen);
    const line = src.slice(0, m.index).split('\n').length;
    rows.push({
      at: `${relative(root, f)}:${line}`,
      uses: used,
      catch: src
        .slice(cOpen + 1, cClose)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 220),
    });
  }
}
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], `${JSON.stringify(rows, null, 1)}\n`);
for (const r of rows) console.log(`${r.at}\t[${r.uses.join(',')}]\t${r.catch || '(empty)'}`);
console.error(`${rows.length} try/catch sites over ${files.length} files`);
