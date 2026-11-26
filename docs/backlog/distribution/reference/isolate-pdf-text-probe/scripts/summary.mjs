// node summary.mjs <results.json> — one block per case: verdict per run, first guest error + first non-runtime frames.
import { readFileSync } from 'node:fs';
const rs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const r of rs) {
  console.log(
    `\n## ${r.case} [${r.pkgs.join(', ')}] ${(r.tree.bytes / 1048576).toFixed(1)} MiB, ${r.tree.files} files${r.tree.nativeFiles ? `, ${r.tree.nativeFiles} .node` : ''}`,
  );
  const seen = new Set();
  for (const run of r.runs) {
    const tag = run.files.length > 1 ? 'ALL' : run.files[0];
    const line = `  ${run.verdict.padEnd(11)} ${tag.padEnd(20)} node ${run.node.exitCode} / guest ${run.guest.exitCode}${run.guest.termination ? ` ${run.guest.termination}` : ''}${run.guest.stateRefused ? ` ${run.guest.stateRefused}` : ''}  ${run.node.ms}ms / ${run.guest.ms}ms`;
    console.log(line);
    if (run.verdict === 'EQUAL') continue;
    const lines = run.guest.stderr.split('\n').filter(Boolean);
    const err = lines
      .filter((l) => !/^\s+at /.test(l))
      .slice(0, 4)
      .join(' ⏎ ');
    const frames = lines
      .filter((l) => /^\s+at /.test(l) && !l.includes('rifty-isolate-guest.js'))
      .slice(0, 3)
      .map((l) => l.trim())
      .join(' < ');
    const key = err + frames;
    if (!seen.has(key)) {
      seen.add(key);
      console.log(`      guest: ${err.slice(0, 700)}\n      frames: ${frames.slice(0, 500)}`);
      if (run.verdict === 'NODE-FAILS')
        console.log(
          `      node: ${run.node.stderr
            .split('\n')
            .filter((l) => l && !/^\s+at /.test(l))
            .slice(0, 4)
            .join(' ⏎ ')
            .slice(0, 500)}`,
        );
      if (run.verdict === 'DIFFERS')
        console.log(
          `      node out:  ${run.node.stdout.slice(0, 400)}\n      guest out: ${run.guest.stdout.slice(0, 400)}`,
        );
    }
  }
  if (r.trace && !r.trace.error) {
    const t = r.trace;
    console.log(
      `  trace(node, exit ${r.traceExit}): modules: ${Object.keys(t.modules).join(', ')}`,
    );
    console.log(
      `    esm: ${
        Object.entries(t.esm)
          .map(([k, v]) => `${k.replace(/^file:.*\//, '')}(${v})`)
          .join(', ') || '-'
      }`,
    );
    console.log(`    globals read: ${Object.keys(t.globals).join(', ')}`);
    console.log(
      `    used: ${
        Object.entries(t.used)
          .map(([k, v]) => `${k}×${v.n}`)
          .join(', ') || '-'
      }`,
    );
    console.log(`    TextDecoder labels: ${t.textDecoderLabels.join(', ') || '-'}`);
  } else if (r.trace) console.log(`  trace error: ${r.trace.error.slice(0, 300)}`);
}
