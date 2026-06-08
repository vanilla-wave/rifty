import type { ParityCase } from '../../src/types.ts';

// Q-2026-06-07-410 — wc's algorithm over fs.readFileSync. Pins four counts the
// builtin must derive Node-equal: lines (count of '\n'), words (non-empty
// whitespace-split tokens), bytes (Buffer.byteLength — multibyte ≠ chars) and
// chars (code points via spread, so an astral 🦀 counts as one, not two UTF-16
// units). The multibyte + no-trailing-newline + blank-line content makes the
// bytes≠chars and lines-vs-final-line distinctions load-bearing.
const c: ParityCase = {
  setup: {
    files: {
      // 3 newlines, last line ("no trailing nl") has no '\n' after it.
      'doc.txt': 'café au lait\n\nналево 世界\nno trailing nl',
    },
  },
  code: `
    const fs = require('node:fs');
    const text = fs.readFileSync('doc.txt', 'utf8');
    const lines = (text.match(/\\n/g) || []).length;
    const words = text.split(/\\s+/).filter(Boolean).length;
    const bytes = Buffer.byteLength(text, 'utf8');
    const chars = [...text].length;
    console.log(JSON.stringify({ lines, words, bytes, chars }));
  `,
};

export default c;
