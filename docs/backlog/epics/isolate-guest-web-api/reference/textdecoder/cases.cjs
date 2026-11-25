// Self-contained corpus runner: evaluated in live Node and in a bare V8 context (no requires).
// `globalThis.__runCases(TD, name)` → one token per case: `<non-fatal output>\u0001<fatal: T | O+output>`
// (`U` = label refused at construction). Deterministic (seeded PRNG).
'use strict';
(() => {
  const MULTI = new Set(['gbk', 'gb18030', 'big5', 'euc-jp', 'iso-2022-jp', 'shift_jis', 'euc-kr']);
  const UTF16 = new Set(['utf-16le', 'utf-16be']);
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
  const ISO_ALPHABET = [
    0x1b, 0x24, 0x28, 0x42, 0x4a, 0x49, 0x40, 0x0e, 0x0f, 0x5c, 0x7e, 0x0a, 0x80,
  ];
  function corpus(name) {
    const cases = [];
    for (let b = 0; b < 256; b++) cases.push({ bytes: [b] });
    if (!MULTI.has(name) && !UTF16.has(name)) return cases;
    for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) cases.push({ bytes: [a, b] });
    if (name === 'euc-jp')
      for (let a = 0xa1; a <= 0xfe; a++)
        for (let b = 0xa1; b <= 0xfe; b++) cases.push({ bytes: [0x8f, a, b] });
    const r = rng(name.length * 7919 + name.charCodeAt(0));
    const byte = () => Math.floor(r() * 256);
    const pick = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    if (name === 'gb18030' || name === 'gbk') {
      for (let i = 0; i < 20000; i++)
        cases.push({
          bytes: [pick(0x81, 0xfe), pick(0x30, 0x39), pick(0x81, 0xfe), pick(0x30, 0x39)],
        });
      for (let i = 0; i < 2000; i++) cases.push({ bytes: [byte(), byte(), byte(), byte()] });
    }
    for (let i = 0; i < 3000; i++) {
      const len = 1 + Math.floor(r() * 10);
      const bytes = [];
      for (let j = 0; j < len; j++) {
        if (name === 'iso-2022-jp' && r() < 0.5)
          bytes.push(
            r() < 0.5 ? ISO_ALPHABET[Math.floor(r() * ISO_ALPHABET.length)] : pick(0x21, 0x7e),
          );
        else if (UTF16.has(name) && r() < 0.3) bytes.push(pick(0xd8, 0xdf));
        else bytes.push(byte());
      }
      cases.push({ bytes });
    }
    for (let i = 0; i < 1000; i++) {
      const len = 2 + Math.floor(r() * 10);
      const bytes = [];
      for (let j = 0; j < len; j++)
        bytes.push(
          name === 'iso-2022-jp' && r() < 0.5 ? ISO_ALPHABET[Math.floor(r() * 7)] : byte(),
        );
      cases.push({ bytes, split: 1 + Math.floor(r() * (len - 1)) });
    }
    if (UTF16.has(name)) {
      const bom = name === 'utf-16le' ? [0xff, 0xfe] : [0xfe, 0xff];
      const a = name === 'utf-16le' ? [0x41, 0] : [0, 0x41];
      for (const ignoreBOM of [false, true]) {
        cases.push({ bytes: [...bom, ...a], ignoreBOM });
        cases.push({ bytes: [...bom, ...bom, ...a], ignoreBOM });
        cases.push({ bytes: [...bom, ...a], ignoreBOM, split: 1 });
      }
    }
    return cases;
  }
  function run(TD, name, c, fatal) {
    let d;
    try {
      d = new TD(name, { fatal, ignoreBOM: !!c.ignoreBOM });
    } catch {
      return 'U';
    }
    const u = new Uint8Array(c.bytes);
    try {
      const s =
        c.split === undefined
          ? d.decode(u)
          : d.decode(u.subarray(0, c.split), { stream: true }) + d.decode(u.subarray(c.split));
      return fatal ? `O${s}` : s;
    } catch {
      return 'T';
    }
  }
  globalThis.__runCases = (TD, name) =>
    corpus(name).map((c) => `${run(TD, name, c, false)}\u0001${run(TD, name, c, true)}`);
  globalThis.__describeCase = (name, i) => corpus(name)[i];
})();
