// Multi-call `stream: true` scenarios for one decoder each, valid and invalid bytes, `fatal` both ways,
// a decoder reused after its errors (ADR-0577, PR #459 review B2/S1). Self-contained: runs in live Node
// and in the guest. `globalThis.__runStreams(TD, name)` → one token per scenario: each call's outcome
// (`S<text>` or `E<code>`) joined by U+0002; `__streamScenario(name, i)` → its chunks and flags.
'use strict';
(() => {
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Bytes that make partial and invalid sequences likely, per decoder family. */
  const ALPHABET = {
    'utf-8': [
      0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0xef, 0xbb, 0xbf, 0x41, 0xff, 0x80,
    ],
    'utf-16le': [0, 0xd8, 0xdc, 0x41, 0x3d, 0xde, 0xfe, 0xff],
    'utf-16be': [0, 0xd8, 0xdc, 0x41, 0x3d, 0xde, 0xfe, 0xff],
    gb18030: [0x81, 0x30, 0xfe, 0x39, 0x84, 0x31, 0xa4, 0xa1, 0x41, 0x80, 0xff],
    gbk: [0x81, 0x30, 0xfe, 0x39, 0x84, 0x31, 0xa4, 0xa1, 0x41, 0x80, 0xff],
  };
  const MANY = new Set(['utf-8', 'utf-16le', 'utf-16be', 'gb18030', 'gbk']);
  function scenarios(name) {
    const r = rng(name.length * 104729 + name.charCodeAt(name.length - 1));
    const alpha = ALPHABET[name] ?? [0x41, 0x80, 0xa0, 0xff];
    const byte = () => (r() < 0.7 ? alpha[Math.floor(r() * alpha.length)] : Math.floor(r() * 256));
    const out = [];
    for (const fatal of [false, true])
      for (let i = 0; i < (MANY.has(name) ? 2000 : 200); i++) {
        const k = 2 + Math.floor(r() * 4);
        const chunks = Array.from({ length: k }, () =>
          Array.from({ length: Math.floor(r() * 5) }, byte),
        );
        const flush = chunks.map((_, j) => (j === k - 1 ? r() < 0.7 : r() < 0.15));
        out.push({ fatal, chunks, flush });
      }
    return out;
  }
  function run(TD, name, s) {
    const d = new TD(name, { fatal: s.fatal });
    return s.chunks
      .map((c, i) => {
        try {
          return `S${d.decode(new Uint8Array(c), { stream: !s.flush[i] })}`;
        } catch (e) {
          return `E${e?.code}`;
        }
      })
      .join('\u0002');
  }
  globalThis.__runStreams = (TD, name) => scenarios(name).map((s) => run(TD, name, s));
  globalThis.__streamScenario = (name, i) => scenarios(name)[i];
})();
