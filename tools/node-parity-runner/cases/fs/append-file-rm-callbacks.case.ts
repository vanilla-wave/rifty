import type { ParityCase } from '../../src/types.ts';

/** Callback `fs.appendFile` (string, encoding argument, options, create, ENOENT dir) and `fs.rm` (file, ENOENT, force, a dir without/with recursive). */
const c: ParityCase = {
  code: `
const fs = require('node:fs');
const out = (e) => (e ? e.code + " " + e.syscall : "ok");
fs.writeFileSync('a.txt', 'x');
fs.mkdirSync('d/sub', { recursive: true });
fs.writeFileSync('d/sub/f', '1');
const steps = [
  (n) => fs.appendFile('a.txt', 'y', (e) => n('appendFile string', out(e) + ' ' + fs.readFileSync('a.txt', 'utf8'))),
  (n) => fs.appendFile('a.txt', '7a', 'hex', (e) => n('appendFile encoding arg', out(e) + ' ' + fs.readFileSync('a.txt', 'utf8'))),
  (n) => fs.appendFile('a.txt', Buffer.from('w'), { flag: 'a', encoding: 'utf8' }, (e) => n('appendFile options', out(e) + ' ' + fs.readFileSync('a.txt', 'utf8'))),
  (n) => fs.appendFile('b.txt', 'new', (e) => n('appendFile creates', out(e) + ' ' + fs.readFileSync('b.txt', 'utf8'))),
  (n) => fs.appendFile('nope/c.txt', 'x', (e) => n('appendFile ENOENT dir', out(e))),
  (n) => fs.rm('b.txt', (e) => n('rm file', out(e) + ' ' + fs.existsSync('b.txt'))),
  (n) => fs.rm('b.txt', (e) => n('rm ENOENT', out(e))),
  (n) => fs.rm('b.txt', { force: true }, (e) => n('rm force missing', out(e))),
  (n) => fs.rm('d', (e) => n('rm dir without recursive', out(e))),
  (n) => fs.rm('d', { recursive: true }, (e) => n('rm recursive', out(e) + ' ' + fs.existsSync('d'))),
];
(async () => { for (const s of steps) await new Promise((r) => s((name, v) => { console.log(name + ' => ' + v); r(); })); })();
  `,
};

export default c;
