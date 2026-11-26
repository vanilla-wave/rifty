// The core's emitters under EventEmitter's listener limit: the warning, its event, setMaxListeners(-1).
const { PassThrough } = require('node:stream');
const seen = [];
process.on('warning', (w) =>
  seen.push(`${w.name}|${w.emitter?.constructor?.name}|${w.type}|${w.count}`),
);
const src = new PassThrough();
for (let i = 0; i < 11; i++) src.pipe(new PassThrough());
src.end('x');
let threw;
try {
  new PassThrough().setMaxListeners(-1);
  threw = 'no throw';
} catch (e) {
  threw = `${e.name}|${e.code}`;
}
console.log(`setMaxListeners(-1) => ${threw}`);
setTimeout(() => console.log(`warning events => ${seen.join(' ; ') || 'none'}`), 20);
