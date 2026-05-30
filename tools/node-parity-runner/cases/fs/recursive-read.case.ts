import type { ParityCase } from '../../src/types.ts';

/**
 * F09-T1 — Read-substitute parity case (feature 09, tool-ceiling marker, P5).
 *
 * Pins the FEASIBLE-side READ primitive the opencode read tool consumes: a
 * recursive directory walk via `fs.readdirSync(dir, { withFileTypes: true })`
 * plus `fs.readFileSync(p, 'utf8')`, run entirely in-realm over rifty's
 * `node:fs` builtin (zero process spawn) and diffed against real Node.
 *
 * This is a permanent regression pin for the read substitute, NOT a manufactured
 * red — the fs builtin already supports both APIs, so it may pass on first run.
 * Its value is locking the read primitive Node-equal so a future fs divergence
 * (off-by-one Dirent classification, a lost subtree, a utf8 decode difference)
 * is caught. Paths are cwd-relative because the harness anchors the rifty
 * sync-mirror at `/` and the Node child at its temp cwd (see run-in-rifty.ts /
 * run-in-node.ts), so both runtimes see the fixtures under `.`.
 */
const c: ParityCase = {
  setup: {
    files: {
      'a.txt': 'one',
      'sub/b.txt': 'two',
      'sub/deep/c.txt': 'three',
    },
  },
  code: `
    const fs = require('node:fs');
    const path = require('node:path');
    function walk(dir) {
      const out = [];
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          out.push(...walk(p));
        } else if (ent.isFile()) {
          out.push({ path: p, content: fs.readFileSync(p, 'utf8') });
        }
      }
      return out;
    }
    const found = walk('.').sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
    console.log(JSON.stringify(found));
  `,
};

export default c;
