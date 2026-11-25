/** The probe's deterministic inputs (docs/backlog/runtime-js/reference/zlib-engine-probe/corpus.mjs). */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  'the quick brown fox jumps over lazy dog lorem ipsum dolor sit amet zlib deflate inflate stream window buffer node rifty sandbox chunk flush'.split(
    ' ',
  );

export function text(n: number, seed = 1): Uint8Array {
  const r = prng(seed);
  let s = '';
  while (s.length < n) s += WORDS[Math.floor(r() * WORDS.length)] + (r() < 0.1 ? '.\n' : ' ');
  return new TextEncoder().encode(s.slice(0, n));
}

export function random(n: number, seed = 2): Uint8Array {
  const r = prng(seed);
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(r() * 256);
  return b;
}

export function json(n: number, seed = 3): Uint8Array {
  const r = prng(seed);
  const rows: string[] = [];
  let len = 0;
  while (len < n) {
    const row = JSON.stringify({
      id: rows.length,
      name: WORDS[Math.floor(r() * WORDS.length)],
      v: Math.floor(r() * 1e6),
      ok: r() < 0.5,
    });
    rows.push(row);
    len += row.length + 1;
  }
  return new TextEncoder().encode(`[${rows.join(',')}]`.slice(0, n));
}

/** Text with low-entropy binary runs: a stand-in for xlsx/pdf payloads. */
export function mixed(n: number, seed = 4): Uint8Array {
  const r = prng(seed);
  const b = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const k = Math.floor(r() * 3);
    const len = Math.min(n - i, 1 + Math.floor(r() * 300));
    if (k === 0) b.fill(Math.floor(r() * 4), i, i + len);
    else if (k === 1) for (let j = 0; j < len; j++) b[i + j] = Math.floor(r() * 256);
    else b.set(text(len, Math.floor(r() * 1e9)).subarray(0, len), i);
    i += len;
  }
  return b;
}

export function corpus(src: Uint8Array) {
  return {
    empty: new Uint8Array(0),
    tiny: new TextEncoder().encode('hello'),
    text64k: text(65536),
    json100k: json(100_000),
    random16k: random(16384),
    zeros100k: new Uint8Array(100_000),
    mixed300k: mixed(300_000),
    zlibSrc: src,
  };
}
