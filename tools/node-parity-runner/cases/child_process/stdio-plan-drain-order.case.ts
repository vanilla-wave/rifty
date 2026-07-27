/**
 * One child-process plan owns every claimed stdio shape, ordered stdin/EOF,
 * final output drain, and exit-before-close.
 */
import type { ParityCase } from '../../src/types.ts';

const stdioChild = `
  const p = typeof __process === 'undefined' ? process : __process;
  const B = require('node:buffer').Buffer;
  const chunks = [];
  p.stdin.on('data', (chunk) => chunks.push(B.from(chunk).toString()));
  p.stdin.on('end', () => {
    const out = 'stdout:' + chunks.join('');
    const err = 'stderr:done';
    if (typeof __stdout_write === 'function') __stdout_write(out);
    else p.stdout.write(out);
    if (typeof __stderr_write === 'function') __stderr_write(err);
    else p.stderr.write(err);
  });
`;

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 5,
  cwd: '/project',
  setup: {
    files: {
      'project/empty.js': '',
      'project/idle.js': 'setInterval(() => {}, 1000);',
      'project/stdio-child.js': stdioChild,
    },
  },
  code: `
    const { fork, spawn } = require('node:child_process');
    const cwd = require('node:process').cwd();
    const waitClose = (child) => new Promise((resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const shape = (child) => ({
      public: [child.stdin, child.stdout, child.stderr]
        .map((stream) => stream === null ? 'null' : 'pipe'),
      slots: child.stdio.map((stream) => stream === null ? 'null' : 'pipe'),
    });

    void (async () => {
      const piped = spawn('node', ['stdio-child.js'], { cwd });
      const pipeShape = shape(piped);
      let stdout = '';
      let stderr = '';
      const order = [];
      piped.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      piped.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      piped.on('exit', (code, signal) => order.push('exit:' + code + '/' + signal));
      const pipedDone = new Promise((resolve) => {
        piped.on('close', (code, signal) => {
          order.push('close:' + code + '/' + signal);
          resolve();
        });
      });
      piped.stdin.write('one');
      piped.stdin.write('two');
      piped.stdin.end();
      await pipedDone;

      const ignored = spawn('node', ['empty.js'], { cwd, stdio: 'ignore' });
      const ignoreShape = shape(ignored);
      await waitClose(ignored);

      const inherited = spawn('node', ['empty.js'], { cwd, stdio: 'inherit' });
      const inheritShape = shape(inherited);
      await waitClose(inherited);

      const explicit = spawn('node', ['empty.js'], {
        cwd,
        stdio: [process.stdin, process.stdout, process.stderr],
      });
      const explicitShape = shape(explicit);
      await waitClose(explicit);

      const nodemonFork = fork('idle.js', [], {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const forkShape = shape(nodemonFork);
      const forkConnected = nodemonFork.connected;
      const forkDone = waitClose(nodemonFork);
      nodemonFork.kill('SIGTERM');
      await forkDone;

      console.log(JSON.stringify({
        pipeShape,
        stdout,
        stderr,
        order,
        ignoreShape,
        inheritShape,
        explicitShape,
        forkShape,
        forkConnected,
      }));
    })().catch((error) => {
      console.log('case-error:' + error.name + ':' + error.message);
    });
  `,
  expected:
    '{"pipeShape":{"public":["pipe","pipe","pipe"],"slots":["pipe","pipe","pipe"]},' +
    '"stdout":"stdout:onetwo","stderr":"stderr:done",' +
    '"order":["exit:0/null","close:0/null"],' +
    '"ignoreShape":{"public":["null","null","null"],"slots":["null","null","null"]},' +
    '"inheritShape":{"public":["null","null","null"],"slots":["null","null","null"]},' +
    '"explicitShape":{"public":["null","null","null"],"slots":["null","null","null"]},' +
    '"forkShape":{"public":["null","null","null"],"slots":["null","null","null","null"]},' +
    '"forkConnected":true}',
};

export default c;
