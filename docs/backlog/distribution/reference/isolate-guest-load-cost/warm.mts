// Consumer-side warm `runCode('1')` of two isolate-host builds: alternating triples (ABA/BAB) after 20
// warm-ups each, medians, bootstrap 95 % interval of the median Δ. usage (repo root):
//   node warm.mts <abs dist dir A> <abs dist dir B> [n]   (a dist dir = packages/isolate-host/dist,
//   another build's copied beside it with its own guest.js)
const [baseDir, newDir, nArg] = process.argv.slice(2);
const base = await import(baseDir + '/index.js');
const neu = await import(newDir + '/index.js');
const n = Number(nArg ?? 240);
const time = async (m) => {
  const t = performance.now();
  const r = await m.runCode('1');
  if (r.exitCode !== 0) throw new Error('run failed');
  return performance.now() - t;
};
for (let i = 0; i < 20; i++) {
  await time(base);
  await time(neu);
}
const a = [],
  b = [];
for (let i = 0; i < n / 2; i++) {
  // triples, alternating: A B A / B A B
  if (i % 2 === 0) {
    a.push(await time(base));
    b.push(await time(neu));
    a.push(await time(base));
    b.push(await time(neu));
  } else {
    b.push(await time(neu));
    a.push(await time(base));
    b.push(await time(neu));
    a.push(await time(base));
  }
}
const med = (x) => {
  const s = [...x].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
};
const q = (x, p) => {
  const s = [...x].sort((p1, q1) => p1 - q1);
  return s[Math.floor(s.length * p)];
};
// bootstrap CI of median difference
const boots = [];
for (let k = 0; k < 2000; k++) {
  const ra = a.map(() => a[Math.floor(Math.random() * a.length)]);
  const rb = b.map(() => b[Math.floor(Math.random() * b.length)]);
  boots.push(med(rb) - med(ra));
}
console.log(
  JSON.stringify({
    n: a.length,
    base: { med: med(a), p10: q(a, 0.1), p90: q(a, 0.9) },
    change: { med: med(b), p10: q(b, 0.1), p90: q(b, 0.9) },
    delta: med(b) - med(a),
    ci95: [q(boots, 0.025), q(boots, 0.975)],
  }),
);
process.exit(0);
