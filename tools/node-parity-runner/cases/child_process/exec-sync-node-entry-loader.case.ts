/**
 * `execSync('node x.js')` routes the child through the module loader (ADR-0137):
 * a `#!` shebang is STRIPPED (not a SyntaxError, not echoed), a relative
 * `require('./util.js')` RESOLVES against the store, and a sibling
 * `fs.readFileSync('./data.txt')` READS it — exactly like
 * `child_process.spawn('node', ['x.js'])` already does.
 *
 * Pre-fix, execSync's child ran the raw bytes through `new Function` /
 * `new AsyncFunction`: it threw "Invalid or unexpected token" on the `#!` line,
 * could not resolve `./util.js`, and read an empty mirror. Real Node's real
 * `execSync` does all three; this pins parity.
 *
 * stdout is byte-exact (ADR-0084 #23), so the child prints plain ASCII the
 * harness's UTF-8 capture preserves on both runtimes.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'build.js':
        '#!/usr/bin/env node\n' +
        "const fs = require('node:fs');\n" +
        "const { tag } = require('./util.js');\n" +
        "const data = fs.readFileSync('./data.txt', 'utf8');\n" +
        'process.stdout.write(`${tag}:${data}`);\n',
      'util.js': "module.exports = { tag: 'built' };\n",
      'data.txt': 'payload',
    },
  },
  // Relative entry (real Node runs the child in the case tmpdir, so `build.js`
  // resolves against that cwd). The rifty side resolves it against the harness
  // cwd (`/`, where `setup.files` mount); the relative `require('./util.js')`
  // resolves against `build.js`'s dir, and `./data.txt` against `process.cwd()`.
  code: `
    const { execSync } = require('node:child_process');
    const out = execSync('node build.js');
    console.log(out.toString());
  `,
  expected: 'built:payload',
  kind: 'exec-sync',
};

export default c;
