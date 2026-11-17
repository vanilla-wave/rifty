#!/usr/bin/env node
/**
 * Captures `command-lists-bash-3.2.57.json`: the frozen bash reference for
 * newline lists, line continuation, `#` comments, heredoc/here-string and
 * compound-command syntax (ADR-0093 frozen tier — never a CI oracle).
 *
 * Re-capture is a reviewed act: `node packages/shell/fixtures/bash/capture-command-lists.mjs`
 * on a host whose `/bin/bash` is GNU bash 3.2.57; refuses any other version.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASH = '/bin/bash';
const ENV = { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' };

/** [id, command, setup files] — setup paths are relative to the case cwd. */
const CASES = [
  ['newline-separates', 'echo a\necho b'],
  ['newline-redirects', 'echo hi > a.txt\necho bye > b.txt'],
  ['newline-after-and', 'true &&\necho b'],
  ['newline-after-or', 'false ||\necho b'],
  ['newline-after-pipe', 'echo a |\ncat'],
  ['newline-after-semicolon', 'echo a;\necho b'],
  ['newline-blank-lines', '\n\necho a\n\n'],
  ['newline-blank-after-and', 'true &&\n\necho b'],
  ['newline-keeps-exit', 'false\n'],
  ['newline-no-short-circuit', 'false\necho ran'],
  ['newline-and-chain', 'false &&\necho skipped\necho next'],
  ['newline-crlf', 'echo a\r\necho b'],
  ['assign-newline-expand', 'X=1\necho $X'],
  ['assign-semicolon-expand', 'X=1; echo $X'],
  ['assign-and-expand', 'X=1 && echo $X'],
  ['assign-prefix-not-expanded', 'X=outer; X=inner echo $X'],
  ['assign-pipeline-subshell', 'X=1 | cat\necho [$X]'],
  ['assign-path-later-line', 'D=out\nmkdir $D\necho hi > $D/f.txt'],
  ['continuation-between-words', 'echo a \\\necho b'],
  ['continuation-in-word', 'ec\\\nho a'],
  ['continuation-before-space', 'echo a\\\n b'],
  ['continuation-at-start', '\\\necho a'],
  ['double-quoted-newline', 'echo "a\nb"'],
  ['single-quoted-newline', "echo 'a\nb'"],
  ['double-quoted-continuation', 'echo "a\\\nb"'],
  ['single-quoted-continuation', "echo 'a\\\nb'"],
  ['comment-trailing', 'echo a # c'],
  ['comment-only', '# only'],
  ['comment-lines', '# c1\necho a # c2\necho b'],
  ['comment-mid-word', 'echo a#b'],
  ['comment-quoted-escaped', 'echo \'#x\' "#y" \\#z'],
  ['comment-after-semicolon', 'echo a;#c'],
  ['comment-after-and', 'echo a && # c\necho b'],
  ['comment-hides-syntax', "echo a # it's $(x) <<EOF & if `"],
  ['comment-backslash-not-continuation', 'echo a #c \\\necho b'],
  ['comment-after-escaped-space', 'echo a\\ #b'],
  ['comment-keeps-exit', 'false # c'],
  ['reserved-words-as-arguments', 'echo if then fi do done { } ! [[ ]] in'],
  ['reserved-word-quoted', "'if' true"],
  ['heredoc-quoted', "cat <<'EOF'\ntouch heredoc-body-ran\nEOF"],
  ['heredoc-unquoted', 'X=v; cat <<EOF\nhello $X\nEOF'],
  ['heredoc-strip-tabs', 'cat <<-EOF\n\thello\n\tEOF'],
  ['heredoc-no-space', 'cat<<EOF\nx\nEOF'],
  ['heredoc-literal-body', "cat > f.js <<'JS'\nconst s = `t` & 1;\nJS"],
  ['heredoc-after-side-effect', 'echo pre > pre.txt; cat <<EOF\nx\nEOF'],
  ['here-string', 'cat <<< hi'],
  ['here-string-after-side-effect', 'touch t; cat <<< hi'],
  ['heredoc-operator-quoted', 'echo \'<<\' "<<<" a\\<\\<b'],
  ['compound-if-multiline', 'if [ -f nope ]\nthen\nrm -rf dist\nfi', { 'dist/keep.txt': 'k\n' }],
  ['compound-if-one-line', 'echo a; if true; then echo b; fi'],
  ['compound-for', 'for f in a b\ndo\necho $f\ndone'],
  ['compound-while', 'while false\ndo\necho x\ndone'],
  ['compound-until', 'until true\ndo\necho x\ndone'],
  ['compound-case', 'case a in\na) echo A;;\nesac'],
  ['compound-group', '{ echo a\necho b\n}'],
  ['compound-group-close-later', 'echo a\n}'],
  ['compound-subshell', '( echo a )'],
  ['compound-subshell-word', '(cd . && echo a)'],
  ['compound-arithmetic', '(( 1 ))'],
  ['compound-function-keyword', 'function f {\necho a\n}\nf'],
  ['compound-function-definition', 'f() { echo in; }; f'],
  ['compound-bang', '! false && echo neg'],
  ['compound-double-bracket', '[[ -d . ]] && echo d'],
  ['reserved-then', 'echo a; then'],
  ['reserved-elif', 'echo a; elif'],
  ['reserved-else', 'echo a; else'],
  ['reserved-fi', 'echo a; fi'],
  ['reserved-do', 'echo a; do'],
  ['reserved-done', 'echo a; done'],
  ['reserved-esac', 'echo a; esac'],
  ['reserved-in', 'echo a; in'],
  ['reserved-close-brace', 'echo a; }'],
  ['reserved-close-bracket', 'echo a\n]]'],
];

function snapshot(root, rel = '') {
  const out = {};
  for (const name of readdirSync(join(root, rel)).sort()) {
    const path = rel ? `${rel}/${name}` : name;
    if (statSync(join(root, path)).isDirectory()) {
      out[`${path}/`] = '';
      Object.assign(out, snapshot(root, path));
    } else out[path] = readFileSync(join(root, path), 'utf8');
  }
  return out;
}

const version = spawnSync(BASH, ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0];
if (!version.startsWith('GNU bash, version 3.2.57(')) {
  throw new Error(`refusing to capture: ${BASH} is ${version}`);
}

const cases = CASES.map(([id, command, setup = {}]) => {
  const cwd = mkdtempSync(join(tmpdir(), 'rifty-bash-lists-'));
  try {
    for (const [path, body] of Object.entries(setup)) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), body);
    }
    const run = spawnSync(BASH, ['--noprofile', '--norc', '-c', command], {
      cwd,
      env: ENV,
      encoding: 'utf8',
    });
    return {
      id,
      command,
      setup,
      bash: {
        stdout: run.stdout,
        // The only normalization: the interpreter path that prefixes diagnostics.
        stderr: run.stderr.replaceAll(`${BASH}: `, 'bash: '),
        exit: run.status,
        files: snapshot(cwd),
      },
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

const sw = spawnSync('sw_vers', [], { encoding: 'utf8' }).stdout.trim().replace(/\s+/g, ' ');
const fixture = {
  reference: 'frozen shell-conformance capture (ADR-0093), not a live oracle',
  capture: {
    shell: version,
    invocation: `${BASH} --noprofile --norc -c <command>`,
    env: ENV,
    host: sw,
    node: process.version,
    script: 'packages/shell/fixtures/bash/capture-command-lists.mjs',
  },
  cases,
};
const out = fileURLToPath(new URL('./command-lists-bash-3.2.57.json', import.meta.url));
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`${cases.length} cases → ${out}`);
