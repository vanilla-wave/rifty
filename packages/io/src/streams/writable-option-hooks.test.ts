import { Writable as NativeWritable } from 'node:stream';
import { expect, it } from 'vitest';
import { Writable } from './writable.ts';

const run = new Function(
  'Writable',
  `
return new Promise((resolve, reject) => {
  const events=[];
  const write=function(chunk, encoding, done){events.push('original-write');done();};
  const writev=function(chunks, done){events.push('original-writev');done();};
  const final=function(done){events.push('original-final');done();};
  const stream=new Writable({write,writev,final});
  const shape=['_write','_writev','_final'].map((key,i)=>({own:Object.hasOwn(stream,key),same:stream[key]===[write,writev,final][i]}));
  stream._write=function(chunk, encoding, done){events.push('write:'+chunk);done();};
  stream._writev=function(chunks, done){events.push('writev:'+chunks.map(x=>String(x.chunk)).join(''));done();};
  stream._final=function(done){events.push('final');done();};
  stream.on('error',reject);stream.on('finish',()=>resolve({shape,events}));
  stream.write('a');stream.cork();stream.write('b');stream.write('c');stream.end();
});
`,
) as (constructor: unknown) => Promise<unknown>;

it('constructor hooks are the replaceable native write/writev/final methods', async () => {
  expect(await run(Writable)).toEqual(await run(NativeWritable));
});
