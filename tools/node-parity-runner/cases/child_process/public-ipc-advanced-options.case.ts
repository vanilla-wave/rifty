/**
 * The `serialization` option itself (ADR-0448): only `undefined`, `'json'` and
 * `'advanced'` are accepted, and a plain spawn with `'advanced'` runs as usual
 * because it has no IPC channel.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  cwd: '/project',
  setup: {
    files: {
      // Ambient 'process' in children: this runner mode takes rifty's
      // same-realm route, where it is a wrapper parameter.
      'project/plain.cjs': `
        process.stdout.write('plain-ran:' + typeof process.send);
      `,
      'project/idle.cjs': `
        process.on('message', () => {});
      `,
    },
  },
  code: `
    const { fork, spawn } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const rows = [];
    const row = (label, value) => rows.push(label + ' ' + JSON.stringify(value));

    void (async () => {
      for (const serialization of ['bogus', 'JSON', 1, null]) {
        try {
          const child = fork('idle.cjs', [], { cwd, serialization, stdio: 'ignore' });
          child.kill();
          row('option:' + String(serialization), 'forked');
        } catch (error) {
          row('option:' + String(serialization), {
            class: error.constructor.name,
            code: error.code ?? null,
            message: error.message,
          });
        }
      }

      const plain = await new Promise((resolve) => {
        try {
          const child = spawn('node', ['plain.cjs'], { cwd, serialization: 'advanced' });
          let stdout = '';
          child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
          child.on('close', (code) => resolve({ send: typeof child.send, stdout, code }));
        } catch (error) {
          resolve({ threw: error.name + ':' + error.message });
        }
      });
      row('spawn-advanced-without-ipc', plain);

      console.log(rows.join('\\n'));
    })().catch((error) => {
      console.log('case-error:' + error.name + ':' + error.message);
    });
  `,
};

export default c;
