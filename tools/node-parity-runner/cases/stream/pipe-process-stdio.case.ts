import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  stdin: [],
  code: `
    const { Readable, Writable } = require('node:stream');
    const p = require('node:process');
    (async () => {
      for (const [name, destination] of [['stdout', p.stdout], ['stderr', p.stderr]]) {
        const source = Readable.from([name + '-data|']);
        const ended = new Promise(resolve => source.once('end', resolve));
        source.pipe(destination, { end: true });
        await ended;
        destination.write(name + '-after|');
        console.log(name + '-completed');
      }
      const ordinary = new Writable({ write(chunk, encoding, callback) { callback(); } });
      ordinary.fd = 1;
      const finished = new Promise(resolve => ordinary.once('finish', resolve));
      Readable.from(['data']).pipe(ordinary);
      await finished;
      console.log('ordinary-ended');
    })();
  `,
};

export default c;
