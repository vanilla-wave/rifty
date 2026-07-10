/** Supported virtual `ps` forms preserve the corresponding Node header contracts. */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const { exec } = require('node:child_process');

    function fields(command) {
      return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
          const header = stdout.trim().split(/\\r?\\n/, 1)[0] || '';
          resolve({
            ok: error === null && stderr === '',
            fields: header.trim().split(/\\s+/).sort().join(','),
          });
        });
      });
    }

    Promise.all([fields('ps'), fields('ps -A -o ppid,pid')]).then(([basic, all]) => {
      console.log('basic:' + basic.ok + ':' + basic.fields + '|all:' + all.ok + ':' + all.fields);
    });
  `,
  expected: 'basic:true:CMD,PID,TIME,TTY|all:true:PID,PPID',
};

export default c;
